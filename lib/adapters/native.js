import { browser } from "hatchable";
import { safeFetch } from "lib/security.js";
import { AdapterError, expandTemplate, isObj } from "lib/util.js";
import { jsonList, htmlList, extractMeta, discoverMedia, mapItem, getPath, DRM_RE, NEEDS_JS_RE } from "lib/extract.js";
import { normalizeMedia, normalizeEpisode, normalizeSources, makeId } from "lib/normalize.js";

const PAGE_SIZE = 24;
const arr = (v) => (Array.isArray(v) ? v : []);

async function fetchPage(m, ep, vars) {
  const url = expandTemplate(ep.url, { baseUrl: m.baseUrl, ...vars });
  const r = await safeFetch(url, { allowedDomains: m.allowedDomains, accept: ep.type === "json" ? "application/json,*/*" : "text/html,*/*" });
  if (r.status === 401 || r.status === 403) throw new AdapterError("The source requires authentication or denies access. Muvoplay does not bypass access controls.", "auth_required", 422);
  if (r.status === 404) throw new AdapterError("Not found on the source", "not_found", 404);
  if (!r.ok) throw new AdapterError(`Source responded with HTTP ${r.status}`, "upstream_status");
  return r;
}

async function listFrom(m, ep, vars) {
  const r = await fetchPage(m, ep, vars);
  if (ep.type === "json") return jsonList(r.text, ep);
  const items = htmlList(r.text, ep, r.url);
  if (!items.length && NEEDS_JS_RE.test(r.text)) throw new AdapterError("This page builds its content with JavaScript, which plain extraction cannot read.", "requires_javascript", 422);
  return items;
}

const staticRoot = (m, ep) => (ep.from === "catalog" ? m.endpoints.catalog.data : ep.data);

export const native = {
  async catalog(ext, opts = {}) {
    const m = ext.manifest, ep = m.endpoints.catalog, page = Math.max(1, opts.page || 1);
    const raws = ep.type === "static" ? arr(ep.data).slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : await listFrom(m, ep, { page, type: opts.type || "" });
    return raws.map((r) => normalizeMedia(m.id, r, { demo: m.demo })).filter(Boolean);
  },

  async search(ext, query) {
    const m = ext.manifest, ep = m.endpoints.search;
    let raws;
    if (ep.type === "static") {
      const q = query.toLowerCase();
      raws = arr(staticRoot(m, ep)).filter((r) => [r.title, ...arr(r.alternativeTitles)].some((t) => String(t || "").toLowerCase().includes(q)));
    } else raws = await listFrom(m, ep, { query, page: 1 });
    return raws.map((r) => normalizeMedia(m.id, r, { demo: m.demo })).filter(Boolean);
  },

  async details(ext, rawId) {
    const m = ext.manifest, ep = m.endpoints.details;
    let raw;
    if (ep.type === "static") {
      const root = staticRoot(m, ep);
      const found = Array.isArray(root) ? root.find((x) => String(x.id) === rawId) : root && root[rawId];
      raw = found && { ...found, id: rawId };
    } else if (ep.type === "json") {
      const r = await fetchPage(m, ep, { id: rawId, mediaId: rawId });
      let json; try { json = JSON.parse(r.text); } catch { throw new AdapterError("Source did not return valid JSON", "invalid_json"); }
      const node = getPath(json, ep.dataPath);
      raw = isObj(node) ? { id: rawId, ...mapItem(node, ep.map) } : null;
      if (raw && (raw.id === undefined || raw.id === null)) raw.id = rawId;
    } else {
      const r = await fetchPage(m, ep, { id: rawId, mediaId: rawId });
      raw = { id: rawId, ...extractMeta(r.text, r.url) };
    }
    const media = raw && normalizeMedia(m.id, { ...raw, id: rawId }, { demo: m.demo });
    if (!media) throw new AdapterError("Media not found or incomplete on the source", "not_found", 404);
    return media;
  },

  async episodes(ext, rawId) {
    const m = ext.manifest, ep = m.endpoints.episodes, mediaId = makeId(m.id, rawId);
    const raws = ep.type === "static" ? arr(ep.data && ep.data[rawId]) : await listFrom(m, ep, { id: rawId, mediaId: rawId });
    return raws.map((r) => normalizeEpisode(m.id, mediaId, r)).filter(Boolean)
      .sort((a, b) => (a.season - b.season) || ((a.number ?? 0) - (b.number ?? 0)));
  },

  async streams(ext, rawId, mediaRawId) {
    const m = ext.manifest, ep = m.endpoints.streams, vars = { id: rawId, mediaId: mediaRawId || rawId };
    let raws = [], pageSubs = [];
    if (ep.type === "static") raws = arr(ep.data && ep.data[rawId]);
    else if (ep.type === "direct") raws = [{ url: expandTemplate(ep.url, { baseUrl: m.baseUrl, ...vars }), type: ep.sourceType, quality: ep.quality }];
    else if (ep.type === "json") raws = await listFrom(m, ep, vars);
    else {
      const r = await fetchPage(m, ep, vars);
      let found = discoverMedia(r.text, r.url);
      let text = r.text;
      if (!found.sources.length && ep.render === "auto" && (m.permissions || []).includes("browser")) {
        try { text = String(await browser.html(r.url)); found = discoverMedia(text, r.url); }
        catch { throw new AdapterError("Browser rendering failed for this page", "browser_failed", 502); }
      }
      if (!found.sources.length) {
        if (DRM_RE.test(text)) throw new AdapterError("This page appears to use DRM-protected playback. Muvoplay does not bypass DRM.", "drm_protected", 422);
        if (NEEDS_JS_RE.test(text) || text.length < 600) throw new AdapterError("The page needs JavaScript to reveal its media. Add the \"browser\" permission and set endpoints.streams.render to \"auto\".", "requires_javascript", 422);
        throw new AdapterError("No playable media (mp4, m3u8, webm, mpd) was found on the page", "no_media_found", 404);
      }
      raws = found.sources; pageSubs = found.subtitles;
    }
    if (pageSubs.length) raws = raws.map((s) => ({ ...s, subtitles: s.subtitles || pageSubs }));
    return normalizeSources(m.id, rawId, raws, m);
  },
};