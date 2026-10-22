import { db } from "hatchable";
import { safeFetch, assertSafeUrl, FetchError } from "lib/security.js";
import { ApiError } from "lib/http.js";
import { clip, isObj, compareSemver } from "lib/util.js";
import { validateNativeManifest, validateStremioManifest, UNSUPPORTED_REASONS, FORMATS } from "lib/manifest.js";
import { fromStremioManifest } from "lib/adapters/stremio.js";
import { adapterFor } from "lib/adapters/index.js";
import { splitId } from "lib/normalize.js";

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

/* ---------- public shape (never leaks add-on tokens embedded in URLs) ---------- */
export function toPublic(row) {
  const m = row.manifest || {};
  let baseUrl = m.baseUrl;
  if (m.format === "stremio") { try { baseUrl = new URL(m.baseUrl).origin + "/…"; } catch { baseUrl = ""; } }
  return {
    id: row.id, key: row.extension_key, repositoryId: row.repository_id, repositoryName: row.repository_name || null,
    name: row.name, version: row.version, format: row.format, description: m.description || "", author: m.author || "",
    capabilities: m.capabilities || [], permissions: m.permissions || [], allowedDomains: m.format === "stremio" ? [] : m.allowedDomains || [],
    baseUrl, demo: m.demo === true, enabled: row.enabled, status: row.status, lastError: row.last_error, updatedAt: row.updated_at,
  };
}

export async function listExtensions(userId) {
  const { rows } = await db.query(
    "SELECT e.*, r.name AS repository_name FROM extensions e LEFT JOIN repositories r ON r.id = e.repository_id WHERE e.owner_id = $1 ORDER BY e.name", [userId]);
  return rows;
}

export async function getExtension(userId, providerId) {
  const { rows } = await db.query("SELECT * FROM extensions WHERE owner_id = $1 AND extension_key = $2", [userId, providerId]);
  return rows[0] || null;
}

/** Runs a capability on the extension that owns an id like provider~rawId. */
export async function runCapability(userId, providerId, cap, fn) {
  const ext = await getExtension(userId, providerId);
  if (!ext) throw new ApiError(404, "extension_not_found", "The extension that provides this item is not installed");
  if (!ext.enabled || ext.status !== "installed") throw new ApiError(409, "extension_disabled", `${ext.name} is ${ext.enabled ? ext.status : "disabled"}`);
  if (!(ext.manifest.capabilities || []).includes(cap)) throw new ApiError(501, "unsupported_capability", `${ext.name} does not support "${cap}"`);
  try {
    const out = await fn(adapterFor(ext.format), ext);
    if (ext.last_error) await db.query("UPDATE extensions SET last_error = NULL WHERE id = $1", [ext.id]);
    return { ext, out };
  } catch (e) {
    if (e && e.code !== "not_found") await db.query("UPDATE extensions SET last_error = $2 WHERE id = $1", [ext.id, clip(e.message, 300)]);
    throw e;
  }
}

export function resolveId(id) {
  const s = splitId(id);
  if (!s) throw new ApiError(400, "validation_error", "Invalid media id");
  return s;
}

/* ---------- manifest resolution & install ---------- */
const unsupportedErr = (fmt) => new ApiError(422, "unsupported_format", UNSUPPORTED_REASONS[fmt]);

export function resolveFromJson(j, url) {
  if (isObj(j) && (j.format === "cloudstream" || j.format === "vega")) throw unsupportedErr(j.format);
  if (isObj(j) && j.schemaVersion !== undefined) {
    const v = validateNativeManifest(j);
    if (!v.ok) throw new ApiError(422, "invalid_manifest", "Manifest is invalid: " + v.errors[0], v.errors);
    return v.manifest;
  }
  if (isObj(j) && (Array.isArray(j.resources) || Array.isArray(j.catalogs))) {
    if (!url) throw new ApiError(422, "invalid_manifest", "Stremio add-ons must be installed from their manifest URL");
    let m;
    try { m = fromStremioManifest(j, url); } catch (e) { throw e instanceof ApiError || e.code ? e : new ApiError(422, "invalid_manifest", e.message); }
    const v = validateStremioManifest(m);
    if (!v.ok) throw new ApiError(422, "invalid_manifest", "Add-on manifest is invalid: " + v.errors[0], v.errors);
    return m;
  }
  throw new ApiError(422, "invalid_manifest", "Unrecognized manifest. Expected a .muvoplay.json manifest or a Stremio add-on manifest.");
}

export async function resolveFromUrl(url) {
  assertSafeUrl(url);
  if (/\.cs3(\?|#|$)/i.test(url)) throw unsupportedErr("cloudstream");
  const r = await safeFetch(url, { maxBytes: 500000, accept: "application/json" });
  if (!r.ok) throw new FetchError(`Manifest URL responded with HTTP ${r.status}`, "manifest_unavailable");
  let j;
  try { j = JSON.parse(r.text); } catch { throw new ApiError(422, "invalid_manifest", "The URL did not return JSON"); }
  return resolveFromJson(j, url);
}

export async function installManifest(userId, m, { repositoryId = null, sourceUrl = null } = {}) {
  const { rows } = await db.query(
    `INSERT INTO extensions (owner_id, repository_id, extension_key, name, version, format, manifest, enabled, status, source_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,FALSE,'installed',$8)
     ON CONFLICT (owner_id, extension_key) DO UPDATE SET repository_id = EXCLUDED.repository_id, name = EXCLUDED.name, version = EXCLUDED.version,
       format = EXCLUDED.format, manifest = EXCLUDED.manifest, status = 'installed', last_error = NULL, source_url = EXCLUDED.source_url, updated_at = now()
     RETURNING *`,
    [userId, repositoryId, m.id, m.name, m.version, m.format, JSON.stringify(m), sourceUrl]
  );
  return rows[0];
}

/* ---------- repository index ---------- */
const stremioKey = (id) => "stremio." + String(id).toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 50);

function indexEntry(e) {
  if (!isObj(e)) return { key: "unknown", name: "Invalid entry", status: "invalid", reason: "Entry is not an object" };
  if (e.schemaVersion !== undefined || e.endpoints !== undefined) {
    const v = validateNativeManifest(e);
    if (!v.ok) return { key: clip(e.id, 64) || "unknown", name: clip(e.name, 80) || "Invalid entry", version: clip(e.version, 20), status: "invalid", reason: v.errors[0], errors: v.errors.slice(0, 5) };
    const m = v.manifest;
    return { key: m.id, name: m.name, version: m.version, description: m.description, author: m.author, format: m.format, capabilities: m.capabilities, permissions: m.permissions, manifest: m, status: "ok" };
  }
  const manifestUrl = typeof e.manifestUrl === "string" ? e.manifestUrl : typeof e.url === "string" ? e.url : null;
  const fmt = /\.cs3(\?|#|$)/i.test(manifestUrl || "") ? "cloudstream" : e.format || "muvoplay-json";
  const base = { key: clip(e.id, 64) || "unknown", name: clip(e.name, 80) || clip(e.id, 64) || "Unnamed", version: clip(e.version, 20) || "0.0.0", description: clip(e.description, 500), author: clip(e.author, 80), format: fmt };
  if (fmt === "cloudstream" || fmt === "vega") return { ...base, status: "unsupported", reason: UNSUPPORTED_REASONS[fmt] };
  if (!FORMATS.includes(fmt)) return { ...base, status: "invalid", reason: `Unknown format "${clip(fmt, 30)}"` };
  if (!manifestUrl) return { ...base, status: "invalid", reason: "Entry needs a manifestUrl or an inline manifest" };
  try { assertSafeUrl(manifestUrl); } catch (err) { return { ...base, status: "invalid", reason: `manifestUrl: ${err.message}` }; }
  const key = fmt === "stremio" ? stremioKey(e.id || e.name || "addon") : base.key;
  if (fmt === "muvoplay-json" && !ID_RE.test(key)) return { ...base, status: "invalid", reason: "id must be 2-64 chars: lowercase letters, digits, dot, dash, underscore" };
  return { ...base, key, manifestUrl, status: "ok" };
}

export async function fetchRepoIndex(url) {
  const r = await safeFetch(url, { maxBytes: 1000000, accept: "application/json" });
  if (!r.ok) throw new FetchError(`Repository responded with HTTP ${r.status}`, "repository_unavailable");
  let json;
  try { json = JSON.parse(r.text); } catch { throw new ApiError(422, "invalid_repository", "Repository is not valid JSON"); }
  const list = Array.isArray(json) ? json : json && json.extensions;
  if (!Array.isArray(list)) throw new ApiError(422, "invalid_repository", 'Repository must contain an "extensions" array');
  const entries = list.slice(0, 200).map(indexEntry);
  return { name: clip(json && json.name, 80), entries };
}

export async function refreshRepository(repo) {
  try {
    const { name, entries } = await fetchRepoIndex(repo.url);
    const ok = entries.filter((e) => e.status === "ok").length;
    const { rows } = await db.query(
      "UPDATE repositories SET index_data = $2::jsonb, ext_count = $3, last_error = NULL, last_refreshed_at = now(), name = COALESCE(NULLIF($4,''), name) WHERE id = $1 RETURNING *",
      [repo.id, JSON.stringify(entries), ok, name]);
    return rows[0];
  } catch (e) {
    const msg = clip(e.message, 300);
    await db.query("UPDATE repositories SET last_error = $2, last_refreshed_at = now() WHERE id = $1", [repo.id, msg]);
    throw e;
  }
}

export const publicRepo = (r) => ({
  id: r.id, name: r.name, url: r.url, enabled: r.enabled, extensionCount: r.ext_count, lastError: r.last_error, lastRefreshedAt: r.last_refreshed_at, createdAt: r.created_at,
});

export { compareSemver };