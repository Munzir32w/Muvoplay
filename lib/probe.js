import { safeFetch, FetchError } from "lib/security.js";
import { DRM_RE } from "lib/extract.js";

const typeFromContentType = (ct) =>
  /mpegurl/.test(ct) ? "hls" : /dash\+xml/.test(ct) ? "dash" : /video\/webm/.test(ct) ? "webm" : /video\/mp4|video\/x-m4v/.test(ct) ? "mp4" : null;

function corsStatus(headers, origin, needed) {
  const acao = headers.get("access-control-allow-origin");
  if (acao === "*" || (acao && acao === origin)) return "ok";
  return needed ? "blocked" : "not-required";
}

/**
 * Server-side check of a media URL: reachable, right content, DRM, CORS headers for the app origin.
 * Never throws. Mutates nothing; returns a result object keyed to the source.
 * It cannot prove playback (codecs, geo, expiring tokens) - the player still handles runtime failures.
 */
export async function probeSource(src, { origin, allowedDomains }) {
  const needsCors = src.type === "hls" || src.type === "dash" || src.type === "unknown";
  const headers = { origin };
  try {
    if (src.type === "hls" || src.type === "dash") {
      const r = await safeFetch(src.url, { allowedDomains, timeoutMs: 6000, maxBytes: 300000, headers, accept: "*/*" });
      const base = { status: r.status, contentType: r.contentType, cors: corsStatus(r.headers, origin, true) };
      if (r.status === 401 || r.status === 403) return { ...base, reachable: true, playable: false, reason: "The source requires authentication or denies access" };
      if (r.status === 404 || r.status === 410) return { ...base, reachable: false, playable: false, reason: "The link is expired or no longer exists" };
      if (!r.ok) return { ...base, reachable: false, playable: false, reason: `Source responded with HTTP ${r.status}` };
      const body = r.text.replace(/^\uFEFF/, "").trimStart();
      const valid = src.type === "hls" ? body.startsWith("#EXTM3U") : /<MPD[\s>]/.test(body);
      if (!valid) return { ...base, reachable: true, playable: false, reason: `Not a valid ${src.type === "hls" ? "HLS playlist" : "DASH manifest"}` };
      if (DRM_RE.test(body)) return { ...base, reachable: true, drm: true, playable: false, reason: "DRM-protected stream. Muvoplay does not bypass DRM." };
      if (base.cors === "blocked") return { ...base, reachable: true, playable: false, reason: "The server does not allow browser playback from this app (CORS). A separate proxy module would be needed." };
      return { ...base, reachable: true, playable: true };
    }
    const r = await safeFetch(src.url, { allowedDomains, timeoutMs: 6000, headers: { ...headers, range: "bytes=0-0" }, noBody: true });
    const detected = typeFromContentType(r.contentType);
    const base = { status: r.status, contentType: r.contentType, cors: corsStatus(r.headers, origin, needsCors), detectedType: detected };
    if (r.status === 401 || r.status === 403) return { ...base, reachable: true, playable: false, reason: "The source requires authentication or denies access" };
    if (r.status === 404 || r.status === 410) return { ...base, reachable: false, playable: false, reason: "The link is expired or no longer exists" };
    if (!(r.ok || r.status === 206)) return { ...base, reachable: false, playable: false, reason: `Source responded with HTTP ${r.status}` };
    if (/text\/html/.test(r.contentType)) return { ...base, reachable: true, playable: false, reason: "The URL returns a web page, not media" };
    if (src.type === "unknown" && !detected) return { ...base, reachable: true, playable: false, reason: `Unsupported content type${r.contentType ? ": " + r.contentType.slice(0, 60) : ""}` };
    if (src.type === "unknown" && base.cors === "blocked" && (detected === "hls" || detected === "dash")) return { ...base, reachable: true, playable: false, reason: "The server does not allow browser playback from this app (CORS)" };
    return { ...base, reachable: true, playable: true };
  } catch (e) {
    return { reachable: false, playable: false, reason: e instanceof FetchError || e.name === "SecurityError" ? e.message : "Probe failed" };
  }
}