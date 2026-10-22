import { AdapterError, clip, isObj } from "lib/util.js";
import { safeUrlOrNull } from "lib/security.js";
import { parseHtml, selectAll, selectOne, textOf } from "lib/html.js";

const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Path getter: "a.b[0].c", "items[].name" (maps arrays). Empty path or "$" returns the root. */
export function getPath(obj, path) {
  if (path === undefined || path === "" || path === "$") return obj;
  const tokens = String(path).replace(/\[(\d*)\]/g, ".[$1]").split(".").filter(Boolean);
  const walk = (cur, i) => {
    for (; i < tokens.length; i++) {
      const t = tokens[i];
      if (cur === null || cur === undefined) return undefined;
      if (t === "[]") {
        if (!Array.isArray(cur)) return undefined;
        return cur.map((x) => walk(x, i + 1)).filter((x) => x !== undefined);
      }
      const idx = t.match(/^\[(\d+)\]$/);
      if (idx) cur = Array.isArray(cur) ? cur[Number(idx[1])] : undefined;
      else { if (BAD_KEYS.has(t) || typeof cur !== "object") return undefined; cur = cur[t]; }
    }
    return cur;
  };
  return walk(obj, 0);
}

export function mapItem(raw, map) {
  if (!map) return isObj(raw) ? raw : null;
  const out = {};
  for (const [k, expr] of Object.entries(map)) out[k] = expr.startsWith("=") ? expr.slice(1) : getPath(raw, expr);
  return out;
}

export function jsonList(text, ep) {
  let json;
  try { json = JSON.parse(text); } catch { throw new AdapterError("Source did not return valid JSON", "invalid_json"); }
  const arr = getPath(json, ep.itemsPath);
  if (!Array.isArray(arr)) throw new AdapterError(`itemsPath "${ep.itemsPath ?? "$"}" did not resolve to a list`, "bad_mapping");
  return arr.slice(0, 200).map((r) => mapItem(r, ep.map)).filter(Boolean);
}

const URL_ATTRS = new Set(["href", "src", "poster", "data-src", "data-href", "data-poster", "data-original"]);

function pickField(el, f, pageUrl) {
  let node;
  try { node = f.selector === ":self" ? el : selectOne(el, f.selector); } catch (e) { throw new AdapterError(`Invalid selector: ${e.message}`, "bad_mapping", 422); }
  if (!node) return undefined;
  const attr = f.attr || "text";
  let v = attr === "text" ? textOf(node) : node.attrs[attr.toLowerCase()];
  if (v === undefined || v === null) return undefined;
  v = String(v).trim();
  if (f.regex) {
    try { const m = v.slice(0, 2000).match(new RegExp(f.regex)); v = m ? (m[1] ?? m[0]) : undefined; } catch { v = undefined; }
    return v;
  }
  if (v && URL_ATTRS.has(attr.toLowerCase()) && f.resolve !== false) { try { v = new URL(v, pageUrl).href; } catch {} }
  return v;
}

export function htmlList(html, ep, pageUrl) {
  const root = parseHtml(html);
  let items;
  try { items = selectAll(root, ep.itemSelector, 200); } catch (e) { throw new AdapterError(`Invalid itemSelector: ${e.message}`, "bad_mapping", 422); }
  return items.map((el) => {
    const rec = {};
    for (const [k, f] of Object.entries(ep.fields)) rec[k] = pickField(el, f, pageUrl);
    return rec;
  });
}

/** OpenGraph / JSON-LD / title metadata from an HTML page. */
export function extractMeta(html, pageUrl) {
  const root = parseHtml(html);
  const metas = selectAll(root, "meta", 200);
  const og = (p) => { const m = metas.find((x) => x.attrs.property === p || x.attrs.name === p); return m ? m.attrs.content : undefined; };
  const titleEl = selectOne(root, "title");
  const abs = (u) => { try { return u ? safeUrlOrNull(new URL(u, pageUrl).href) : null; } catch { return null; } };
  const meta = {
    title: clip(og("og:title") || (titleEl ? textOf(titleEl) : ""), 200),
    description: clip(og("og:description") || og("description"), 2000),
    poster: abs(og("og:image")),
    type: og("og:type") && /tv|series|episode/i.test(og("og:type")) ? "series" : "movie",
  };
  for (const s of selectAll(root, "script", 50).filter((x) => x.attrs.type === "application/ld+json")) {
    try {
      const j = JSON.parse((s.children[0] && s.children[0].text) || "null");
      for (const n of Array.isArray(j) ? j : (j && j["@graph"]) || [j]) {
        if (!n || typeof n["@type"] !== "string" || !/Movie|TVSeries|VideoObject|CreativeWork/.test(n["@type"])) continue;
        if (n.name) meta.title = clip(n.name, 200);
        if (n.description) meta.description = clip(n.description, 2000);
        if (typeof n.image === "string") meta.poster = abs(n.image);
        if (n.datePublished) meta.year = parseInt(String(n.datePublished).slice(0, 4), 10);
        if (n.genre) meta.genres = [].concat(n.genre);
        if (/TVSeries/.test(n["@type"])) meta.type = "series";
      }
    } catch {}
  }
  return meta;
}

export function classifyMedia(url, hint) {
  const h = String(hint || "").toLowerCase();
  if (["hls", "mp4", "webm", "dash"].includes(h)) return h;
  if (/mpegurl|m3u8/.test(h)) return "hls";
  if (/dash|mpd/.test(h)) return "dash";
  if (/webm/.test(h)) return "webm";
  if (/mp4|video\/mp4/.test(h)) return "mp4";
  const path = String(url).split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".m3u8")) return "hls";
  if (path.endsWith(".mpd")) return "dash";
  if (path.endsWith(".webm")) return "webm";
  if (path.endsWith(".mp4") || path.endsWith(".m4v")) return "mp4";
  return "unknown";
}

/** Find media and subtitle URLs in an HTML/JS/JSON text. */
export function discoverMedia(text, pageUrl) {
  const t = String(text).replace(/\\\//g, "/").replace(/&amp;/g, "&");
  const found = new Map(); const subs = new Map();
  const re = /(?:https?:)?\/\/[^\s"'<>\\)]+?\.(m3u8|mp4|webm|mpd|vtt|srt)(?:\?[^\s"'<>\\)]*)?/gi;
  let m;
  while ((m = re.exec(t)) && found.size + subs.size < 60) {
    let href; try { href = new URL(m[0].startsWith("//") ? "https:" + m[0] : m[0], pageUrl).href; } catch { continue; }
    const ext = m[1].toLowerCase();
    if (ext === "vtt" || ext === "srt") subs.set(href, { url: href, format: ext });
    else found.set(href, { url: href, type: classifyMedia(href) });
  }
  const attr = /<(?:video|source|track)\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
  while ((m = attr.exec(t)) && found.size < 60) {
    let href; try { href = new URL(m[1], pageUrl).href; } catch { continue; }
    if (/^<track/i.test(m[0])) subs.set(href, { url: href, format: /\.srt/i.test(href) ? "srt" : "vtt", label: (m[0].match(/label=["']([^"']+)/i) || [])[1], lang: (m[0].match(/srclang=["']([^"']+)/i) || [])[1] });
    else if (!found.has(href)) found.set(href, { url: href, type: classifyMedia(href, (m[0].match(/type=["']([^"']+)/i) || [])[1]) });
  }
  return { sources: [...found.values()].filter((s) => s.type !== "unknown"), subtitles: [...subs.values()] };
}

export const DRM_RE = /widevine|playready|fairplay|com\.apple\.streamingkeydelivery|METHOD=SAMPLE-AES|<ContentProtection/i;
export const NEEDS_JS_RE = /enable javascript|requires javascript|<noscript[^>]*>[^<]*(enable|require)/i;