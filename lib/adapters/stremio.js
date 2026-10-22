import { safeFetch, assertSafeUrl } from "lib/security.js";
import { AdapterError, clip } from "lib/util.js";
import { classifyMedia } from "lib/extract.js";
import { normalizeMedia, normalizeEpisode, normalizeSources, makeId } from "lib/normalize.js";

const enc = (s) => encodeURIComponent(s).replace(/%3A/gi, ":");
const key = (type, id) => `${type}/${id}`;
function parseKey(raw) {
  const i = String(raw).indexOf("/");
  if (i < 1) throw new AdapterError("Invalid Stremio item id", "bad_id", 400);
  return { type: raw.slice(0, i), id: raw.slice(i + 1) };
}
const resName = (r) => (typeof r === "string" ? r : r && r.name);
const extraNames = (c) => [...(c.extra || []).map((e) => e.name), ...(c.extraSupported || [])];
const extraRequired = (c) => [...(c.extra || []).filter((e) => e.isRequired).map((e) => e.name), ...(c.extraRequired || [])];

/** Converts a raw Stremio add-on manifest into Muvoplay's internal manifest. */
export function fromStremioManifest(j, manifestUrl) {
  const u = assertSafeUrl(manifestUrl);
  if (!j || typeof j !== "object" || typeof j.id !== "string" || typeof j.name !== "string") throw new AdapterError("Not a valid Stremio add-on manifest (id and name are required)", "invalid_manifest", 400);
  const resources = (j.resources || []).map(resName).filter(Boolean);
  const catalogs = (Array.isArray(j.catalogs) ? j.catalogs : []).filter((c) => c && c.type && c.id).slice(0, 30).map((c) => ({ type: String(c.type), id: String(c.id), name: clip(c.name || c.id, 80), extra: extraNames(c), required: extraRequired(c) }));
  const caps = [];
  if (resources.includes("catalog") && catalogs.some((c) => !c.required.length)) caps.push("catalog");
  if (resources.includes("catalog") && catalogs.some((c) => c.extra.includes("search"))) caps.push("search");
  if (resources.includes("meta")) caps.push("details", "episodes");
  if (resources.includes("stream")) caps.push("streams");
  const base = u.href.replace(/\?.*$/, "").replace(/\/manifest\.json$/, "").replace(/\/+$/, "");
  const ver = String(j.version || "").match(/^\d+\.\d+\.\d+/);
  return {
    schemaVersion: 1, id: "stremio." + j.id.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 50),
    name: clip(j.name, 80), version: ver ? ver[0] : "0.0.0", description: clip(j.description, 500), author: "",
    format: "stremio", capabilities: caps, baseUrl: base, allowedDomains: [u.hostname], permissions: ["network", "external-media"],
    stremio: { catalogs, types: (j.types || []).slice(0, 10), resources },
  };
}

async function sget(m, path) {
  const r = await safeFetch(m.baseUrl + path, { allowedDomains: m.allowedDomains, accept: "application/json" });
  if (r.status === 404) throw new AdapterError("Add-on has no data for this request", "not_found", 404);
  if (!r.ok) throw new AdapterError(`Add-on responded with HTTP ${r.status}`, "upstream_status");
  try { return JSON.parse(r.text); } catch { throw new AdapterError("Add-on returned invalid JSON", "invalid_json"); }
}

const metaToRaw = (meta, fallbackType) => ({
  id: key(meta.type || fallbackType, meta.id), title: meta.name, poster: meta.poster, description: meta.description,
  year: meta.releaseInfo || meta.year, genres: meta.genres || meta.genre, type: meta.type === "series" ? "series" : meta.type === "movie" ? "movie" : "other",
});

async function fromCatalogs(m, catalogs, pathFor) {
  const lists = await Promise.allSettled(catalogs.map(async (c) => (await sget(m, pathFor(c))).metas || []));
  const seen = new Set(); const out = []; let lastErr = null;
  for (const l of lists) {
    if (l.status === "rejected") { lastErr = l.reason; continue; }
    for (const meta of l.value.slice(0, 60)) {
      if (!meta || !meta.id || !meta.name) continue;
      const item = normalizeMedia(m.id, metaToRaw(meta, "movie"));
      if (item && !seen.has(item.id)) { seen.add(item.id); out.push(item); }
    }
  }
  if (!out.length && lastErr) throw lastErr;
  return out;
}

export const stremio = {
  async catalog(ext, opts = {}) {
    const m = ext.manifest, page = Math.max(1, opts.page || 1);
    const cats = m.stremio.catalogs.filter((c) => !c.required.length).slice(0, opts.maxCatalogs || 2);
    return fromCatalogs(m, cats, (c) => `/catalog/${enc(c.type)}/${enc(c.id)}${page > 1 && c.extra.includes("skip") ? `/skip=${(page - 1) * 100}` : ""}.json`);
  },
  async search(ext, query) {
    const m = ext.manifest;
    const cats = m.stremio.catalogs.filter((c) => c.extra.includes("search") && c.required.every((r) => r === "search")).slice(0, 3);
    return fromCatalogs(m, cats, (c) => `/catalog/${enc(c.type)}/${enc(c.id)}/search=${enc(query)}.json`);
  },
  async details(ext, rawId) {
    const m = ext.manifest, { type, id } = parseKey(rawId);
    const { meta } = await sget(m, `/meta/${enc(type)}/${enc(id)}.json`);
    const media = meta && meta.name ? normalizeMedia(m.id, { ...metaToRaw({ ...meta, id, type: meta.type || type }, type), id: rawId }) : null;
    if (!media) throw new AdapterError("Add-on returned no metadata for this item", "not_found", 404);
    return media;
  },
  async episodes(ext, rawId) {
    const m = ext.manifest, { type, id } = parseKey(rawId), mediaId = makeId(m.id, rawId);
    const { meta } = await sget(m, `/meta/${enc(type)}/${enc(id)}.json`);
    return ((meta && meta.videos) || []).slice(0, 500).map((v) => normalizeEpisode(m.id, mediaId, {
      id: key(type, v.id), title: v.title || v.name, number: v.episode ?? v.number, season: v.season, thumbnail: v.thumbnail,
    })).filter(Boolean).sort((a, b) => (a.season - b.season) || ((a.number ?? 0) - (b.number ?? 0)));
  },
  async streams(ext, rawId) {
    const m = ext.manifest, { type, id } = parseKey(rawId);
    const { streams } = await sget(m, `/stream/${enc(type)}/${enc(id)}.json`);
    const raws = []; const skipped = [];
    for (const s of (streams || []).slice(0, 60)) {
      if (!s) continue;
      if (!s.url) { skipped.push({ reason: s.infoHash ? "Torrent streams are not supported in the browser" : s.ytId ? "YouTube streams are not supported" : "External-player stream (no direct URL)" }); continue; }
      if (s.behaviorHints && s.behaviorHints.notWebReady) { skipped.push({ reason: "Stream is not web-ready (needs a proxy/transcode)" }); continue; }
      const text = `${s.name || ""} ${s.title || ""} ${s.description || ""}`;
      raws.push({ url: s.url, type: classifyMedia(s.url), quality: (text.match(/\b(2160p|1440p|1080p|720p|480p|360p|4k)\b/i) || [])[1], language: undefined, subtitles: s.subtitles });
    }
    const res = normalizeSources(m.id, rawId, raws, m);
    return { sources: res.sources, rejected: [...skipped, ...res.rejected] };
  },
};