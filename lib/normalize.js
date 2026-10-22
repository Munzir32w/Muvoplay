import { assertSafeUrl, safeUrlOrNull, hostMatches } from "lib/security.js";
import { clip, isObj } from "lib/util.js";
import { classifyMedia } from "lib/extract.js";

export const MEDIA_TYPES = ["movie", "series", "anime", "other"];
const SEP = "~";

export const makeId = (providerId, raw) => `${providerId}${SEP}${encodeURIComponent(String(raw))}`;
export function splitId(id) {
  const s = String(id || "");
  const i = s.indexOf(SEP);
  if (i < 1 || i === s.length - 1) return null;
  let raw; try { raw = decodeURIComponent(s.slice(i + 1)); } catch { return null; }
  return { providerId: s.slice(0, i), rawId: raw };
}

function toList(v) {
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return v.split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
  if (Array.isArray(v)) return v.map((x) => (isObj(x) ? x.name || x.title || "" : String(x))).map((x) => x.trim()).filter(Boolean);
  return [];
}
const toYear = (v) => { const n = parseInt(String(v ?? "").match(/\d{4}/)?.[0] ?? "", 10); return n >= 1880 && n <= 2100 ? n : null; };
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 100000 ? n : null; };

export function normalizeMedia(providerId, raw, opts = {}) {
  if (!isObj(raw) || raw.id === undefined || raw.id === null || !clip(raw.title, 200)) return null;
  const t = String(raw.type || opts.defaultType || "other").toLowerCase();
  return {
    id: makeId(providerId, raw.id), providerId,
    title: clip(raw.title, 200),
    alternativeTitles: toList(raw.alternativeTitles).slice(0, 10).map((x) => clip(x, 200)),
    poster: safeUrlOrNull(raw.poster),
    description: clip(raw.description, 4000),
    year: toYear(raw.year),
    genres: toList(raw.genres).slice(0, 12).map((x) => clip(x, 40)),
    type: MEDIA_TYPES.includes(t) ? t : "other",
    status: raw.status ? clip(raw.status, 40) : null,
    episodeCount: toNum(raw.episodeCount),
    demo: opts.demo === true,
  };
}

export function normalizeEpisode(providerId, mediaId, raw) {
  if (!isObj(raw) || raw.id === undefined || raw.id === null) return null;
  const number = toNum(raw.number);
  return {
    id: makeId(providerId, raw.id), mediaId,
    title: clip(raw.title, 200) || (number !== null ? `Episode ${number}` : "Episode"),
    number, season: toNum(raw.season) ?? 1,
    thumbnail: safeUrlOrNull(raw.thumbnail),
  };
}

function normalizeSubtitles(list, allowed, external) {
  const out = [];
  for (const s of [].concat(list || [])) {
    const o = typeof s === "string" ? { url: s } : s;
    if (!isObj(o)) continue;
    const url = safeUrlOrNull(o.url, external ? {} : { allowedDomains: allowed });
    if (!url) continue;
    const path = url.split(/[?#]/)[0].toLowerCase();
    const format = path.endsWith(".srt") ? "srt" : "vtt"; // srt is converted to WebVTT by /api/v1/media/subtitle
    out.push({ url, language: clip(o.language || o.lang || "und", 12), label: clip(o.label || o.language || o.lang || "Subtitle", 60), format });
    if (out.length >= 20) break;
  }
  return out;
}

/** Validates each source URL (SSRF + domain policy). Returns { sources, rejected } */
export function normalizeSources(providerId, mediaKey, rawList, manifest) {
  const external = (manifest.permissions || []).includes("external-media");
  const allowed = manifest.allowedDomains || [];
  const sources = []; const rejected = [];
  (rawList || []).forEach((raw, i) => {
    if (!isObj(raw)) return;
    let url;
    try { url = assertSafeUrl(raw.url, external ? {} : { allowedDomains: allowed }).href; }
    catch (e) { rejected.push({ reason: e.message }); return; }
    const type = classifyMedia(url, raw.type);
    if (type === "unknown" && manifest.format !== "stremio") { rejected.push({ reason: "Unrecognized media format" }); return; }
    const exp = raw.expiresAt ? new Date(raw.expiresAt) : null;
    sources.push({
      id: makeId(providerId, `${mediaKey}#${i}`), providerId, url, type,
      quality: raw.quality ? clip(raw.quality, 20) : null,
      language: raw.language ? clip(raw.language, 20) : null,
      subtitles: normalizeSubtitles(raw.subtitles, allowed, external),
      expiresAt: exp && !isNaN(exp) ? exp.toISOString() : null,
    });
  });
  return { sources: sources.slice(0, 30), rejected };
}

export { normalizeSubtitles };
export const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };
export { hostMatches };