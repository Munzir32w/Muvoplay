import { handler, validate, rateLimit, ApiError } from "lib/http.js";
import { runCapability, resolveId } from "lib/service.js";
import { probeSource } from "lib/probe.js";
import { pool } from "lib/util.js";

export const access = "user";
export const methods = ["POST"];

export default handler(async (req) => {
  const uid = req.user.id;
  const b = validate(req.body, {
    id: { type: "string", required: true, max: 600 },
    mediaId: { type: "string", max: 600 },
    probe: { type: "boolean", default: true },
  });
  const target = resolveId(b.id);
  const media = b.mediaId ? resolveId(b.mediaId) : null;
  if (media && media.providerId !== target.providerId) throw new ApiError(400, "validation_error", "mediaId and id belong to different providers");
  await rateLimit(uid, "scrape", 60);
  const { ext, out } = await runCapability(uid, target.providerId, "streams", (a, e) => a.streams(e, target.rawId, media && media.rawId));
  let sources = out.sources;
  if (b.probe && sources.length) {
    const origin = req.headers.origin || `https://${req.headers.host}`;
    const external = (ext.manifest.permissions || []).includes("external-media");
    const allowedDomains = external ? null : ext.manifest.allowedDomains;
    const head = sources.slice(0, 6);
    const checks = await pool(head, 3, (s) => probeSource(s, { origin, allowedDomains }));
    sources = [
      ...head.map((s, i) => {
        const c = checks[i].ok ? checks[i].value : { reachable: false, playable: false, reason: "Check failed" };
        return { ...s, type: s.type === "unknown" && c.detectedType ? c.detectedType : s.type, check: c };
      }),
      ...sources.slice(6),
    ].sort((a, b2) => (b2.check && b2.check.playable ? 1 : 0) - (a.check && a.check.playable ? 1 : 0));
  }
  return { id: b.id, provider: { id: target.providerId, name: ext.name, demo: ext.manifest.demo === true }, sources, rejected: out.rejected || [], probed: b.probe };
});