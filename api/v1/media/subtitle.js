import { handler, validate, rateLimit, ApiError } from "lib/http.js";
import { getExtension } from "lib/service.js";
import { safeFetch, assertSafeUrl } from "lib/security.js";
import { toVtt } from "lib/util.js";

export const access = "user";
export const methods = ["POST"];

// Optional, narrow module: fetches ONE small subtitle file so it can be served same-origin (browsers refuse cross-origin
// <track> files without CORS). It is not a media proxy: size-capped, text only, same URL policy as the extension.

export default handler(async (req) => {
  const uid = req.user.id;
  const b = validate(req.body, { providerId: { type: "string", required: true, max: 64 }, url: { type: "string", required: true, max: 2048 } });
  await rateLimit(uid, "subtitle", 60);
  const ext = await getExtension(uid, b.providerId);
  if (!ext || !ext.enabled) throw new ApiError(404, "extension_not_found", "Extension is not installed or is disabled");
  const external = (ext.manifest.permissions || []).includes("external-media");
  const allowedDomains = external ? null : ext.manifest.allowedDomains;
  assertSafeUrl(b.url, { allowedDomains });
  const r = await safeFetch(b.url, { allowedDomains, maxBytes: 1000000, timeoutMs: 6000, accept: "text/vtt,text/plain,*/*" });
  if (!r.ok) throw new ApiError(502, "subtitle_unavailable", `Subtitle server responded with HTTP ${r.status}`);
  const vtt = toVtt(r.text);
  if (!vtt) throw new ApiError(422, "invalid_subtitle", "The file is not valid WebVTT or SRT");
  return { vtt };
});