import { handler, validate, rateLimit } from "lib/http.js";
import { runCapability, resolveId } from "lib/service.js";

export const access = "user";
export const methods = ["POST"];

export default handler(async (req) => {
  const uid = req.user.id;
  const b = validate(req.body, { mediaId: { type: "string", required: true, max: 600 } });
  const { providerId, rawId } = resolveId(b.mediaId);
  await rateLimit(uid, "scrape", 60);
  try {
    const { out } = await runCapability(uid, providerId, "episodes", (a, e) => a.episodes(e, rawId));
    return { supported: true, total: out.length, episodes: out.slice(0, 500) };
  } catch (e) {
    if (e.code === "unsupported_capability") return { supported: false, total: 0, episodes: [] };
    throw e;
  }
});