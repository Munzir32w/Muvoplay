import { assertSafeUrl } from "lib/security.js";
import { expandTemplate, isObj, clip } from "lib/util.js";

export const CAPS = ["catalog", "search", "details", "episodes", "streams"];
export const PERMS = ["network", "external-media", "subtitles", "browser"];
export const FORMATS = ["muvoplay-json", "stremio", "cloudstream", "vega"];
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const VARS = ["baseUrl", "query", "id", "mediaId", "page", "type"];
const EP_TYPES = {
  catalog: ["json", "html", "static"],
  search: ["json", "html", "static"],
  details: ["json", "meta", "static"],
  episodes: ["json", "html", "static"],
  streams: ["json", "scan", "direct", "static"],
};
const REQUIRED_MAP = { catalog: ["id", "title"], search: ["id", "title"], episodes: ["id"], streams: ["url"] };
const SAMPLE = { query: "test", id: "1", mediaId: "1", page: "1", type: "movie" };

function checkEndpoint(cap, ep, ctx, errors) {
  const p = `endpoints.${cap}`;
  if (!isObj(ep)) return errors.push(`${p} must be an object`);
  if (JSON.stringify(ep).length > 200000) return errors.push(`${p} is too large`);
  if (!EP_TYPES[cap].includes(ep.type)) return errors.push(`${p}.type must be one of: ${EP_TYPES[cap].join(", ")}`);
  if (ep.type === "static") {
    if (ep.data === undefined && ep.from !== "catalog") errors.push(`${p}: static endpoints need "data" (or "from": "catalog")`);
  } else {
    if (typeof ep.url !== "string" || !ep.url || ep.url.length > 1000) return errors.push(`${p}.url is required`);
    const used = [...ep.url.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const bad = used.filter((x) => !VARS.includes(x));
    if (bad.length) return errors.push(`${p}.url uses unknown variables: ${bad.join(", ")}`);
    try { assertSafeUrl(expandTemplate(ep.url, { baseUrl: ctx.baseUrl, ...SAMPLE }), { allowedDomains: ctx.allowedDomains }); }
    catch (e) { errors.push(`${p}.url: ${e.message}`); }
  }
  if (ep.type === "json" || ep.type === "html") {
    const need = REQUIRED_MAP[cap] || [];
    if (ep.type === "json") {
      if (!isObj(ep.map)) { if (need.length) errors.push(`${p}.map is required`); }
      else {
        for (const k of need) if (typeof ep.map[k] !== "string") errors.push(`${p}.map.${k} is required`);
        for (const [k, v] of Object.entries(ep.map)) if (typeof v !== "string" || v.length > 200) errors.push(`${p}.map.${k} must be a short string`);
      }
      if (ep.itemsPath !== undefined && typeof ep.itemsPath !== "string") errors.push(`${p}.itemsPath must be a string`);
    } else {
      if (typeof ep.itemSelector !== "string" || !ep.itemSelector) errors.push(`${p}.itemSelector is required for html endpoints`);
      if (!isObj(ep.fields)) errors.push(`${p}.fields is required for html endpoints`);
      else {
        for (const k of need) if (!ep.fields[k]) errors.push(`${p}.fields.${k} is required`);
        for (const [k, f] of Object.entries(ep.fields)) {
          if (!isObj(f) || typeof f.selector !== "string" || f.selector.length > 200) errors.push(`${p}.fields.${k}.selector is required`);
          if (f && f.regex && (typeof f.regex !== "string" || f.regex.length > 200)) errors.push(`${p}.fields.${k}.regex is too long`);
        }
      }
    }
  }
  if (ep.render !== undefined && ep.render !== "auto") errors.push(`${p}.render may only be "auto"`);
  if (ep.type === "direct" && !ep.sourceType) errors.push(`${p}.sourceType is required for direct endpoints (mp4, hls, webm, dash)`);
}

/** Validates a native muvoplay-json manifest. Returns { ok, errors, manifest }. */
export function validateNativeManifest(m) {
  const errors = [];
  if (!isObj(m)) return { ok: false, errors: ["Manifest must be a JSON object"] };
  if (m.schemaVersion !== 1) errors.push(`Unsupported schemaVersion (${JSON.stringify(m.schemaVersion)}); this app supports 1`);
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) errors.push("id must be 2-64 chars: lowercase letters, digits, dot, dash, underscore");
  if (typeof m.name !== "string" || m.name.trim().length < 1 || m.name.length > 80) errors.push("name is required (max 80 chars)");
  if (typeof m.version !== "string" || !SEMVER.test(m.version)) errors.push("version must be semantic (e.g. 1.0.0)");
  if (m.description !== undefined && (typeof m.description !== "string" || m.description.length > 500)) errors.push("description must be a string up to 500 chars");
  if (m.author !== undefined && (typeof m.author !== "string" || m.author.length > 80)) errors.push("author must be a string up to 80 chars");
  if (m.format !== "muvoplay-json") errors.push('format must be "muvoplay-json"');
  if (!Array.isArray(m.capabilities) || !m.capabilities.length || m.capabilities.some((c) => !CAPS.includes(c))) errors.push(`capabilities must be a non-empty subset of: ${CAPS.join(", ")}`);
  let base = null;
  try { base = assertSafeUrl(m.baseUrl); } catch (e) { errors.push(`baseUrl: ${e.message}`); }
  let allowed = [];
  if (base) {
    allowed = m.allowedDomains === undefined ? [base.hostname] : m.allowedDomains;
    if (!Array.isArray(allowed) || !allowed.length || allowed.length > 20 || allowed.some((d) => typeof d !== "string" || !HOST_RE.test(d.toLowerCase()))) { errors.push("allowedDomains must be a list of hostnames (no wildcards, no schemes)"); allowed = []; }
    else allowed = allowed.map((d) => d.toLowerCase());
    if (allowed.length && !allowed.some((d) => base.hostname === d || base.hostname.endsWith("." + d))) errors.push("baseUrl host must be covered by allowedDomains");
  }
  const perms = m.permissions === undefined ? ["network"] : m.permissions;
  if (!Array.isArray(perms) || perms.some((p) => !PERMS.includes(p))) errors.push(`permissions must be a subset of: ${PERMS.join(", ")}`);
  if (!isObj(m.endpoints)) errors.push("endpoints is required");
  else if (Array.isArray(m.capabilities) && base && allowed.length) {
    for (const cap of m.capabilities) {
      if (!CAPS.includes(cap)) continue;
      if (m.endpoints[cap] === undefined) errors.push(`capability "${cap}" is declared but endpoints.${cap} is missing`);
      else checkEndpoint(cap, m.endpoints[cap], { baseUrl: base.href, allowedDomains: allowed }, errors);
    }
    for (const k of Object.keys(m.endpoints)) if (!CAPS.includes(k)) errors.push(`unknown endpoint "${k}"`);
    if (m.endpoints.streams && m.endpoints.streams.render === "auto" && !(perms || []).includes("browser")) errors.push('endpoints.streams.render "auto" requires the "browser" permission');
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true, errors: [],
    manifest: {
      schemaVersion: 1, id: m.id, name: clip(m.name, 80), version: m.version, description: clip(m.description, 500), author: clip(m.author, 80),
      format: "muvoplay-json", demo: m.demo === true, capabilities: [...new Set(m.capabilities)], baseUrl: base.href.replace(/\/+$/, ""),
      allowedDomains: allowed, permissions: [...new Set(perms)], endpoints: m.endpoints,
    },
  };
}

export function validateStremioManifest(m) {
  const errors = [];
  if (!isObj(m) || m.format !== "stremio") return { ok: false, errors: ["Not a normalized Stremio manifest"] };
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) errors.push("invalid add-on id");
  if (typeof m.version !== "string" || !SEMVER.test(m.version)) errors.push("invalid add-on version");
  try { assertSafeUrl(m.baseUrl); } catch (e) { errors.push(`baseUrl: ${e.message}`); }
  if (!Array.isArray(m.capabilities) || !m.capabilities.length) errors.push("add-on exposes no supported resources (needs catalog, meta or stream)");
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], manifest: m };
}

export const UNSUPPORTED_REASONS = {
  cloudstream: "CloudStream .cs3 plugins are compiled Android/Kotlin packages and cannot run in a browser or in this server runtime. A compatible runtime has not been verified, so they are not installable.",
  vega: "The Vega Provider format has no adapter implementation yet: its specification was not available to verify. The adapter interface exists but no protocol is guessed.",
};

/** Dispatch by format. Returns { ok, errors, manifest, unsupported? } */
export function validateAnyManifest(m) {
  const fmt = isObj(m) ? m.format : undefined;
  if (fmt === "cloudstream" || fmt === "vega") return { ok: false, errors: [], unsupported: UNSUPPORTED_REASONS[fmt], format: fmt };
  if (fmt === "stremio") return validateStremioManifest(m);
  return validateNativeManifest(m);
}