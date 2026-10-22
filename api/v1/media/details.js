import { handler, validate, rateLimit } from "lib/http.js";
import { runCapability, resolveId } from "lib/service.js";
import { fanOut } from "lib/fanout.js";

export const access = "user";
export const methods = ["POST"];

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");

export default handler(async (req) => {
  const uid = req.user.id;
  const b = validate(req.body, { mediaId: { type: "string", required: true, max: 600 }, alternatives: { type: "boolean", default: false } });
  const { providerId, rawId } = resolveId(b.mediaId);
  await rateLimit(uid, "scrape", 60);
  const { ext, out: media } = await runCapability(uid, providerId, "details", (a, e) => a.details(e, rawId));
  const caps = ext.manifest.capabilities || [];
  const result = { media, provider: { id: providerId, name: ext.name, demo: ext.manifest.demo === true, capabilities: caps }, alternatives: [] };
  if (b.alternatives) {
    const others = (await fanOut(uid, "search", (a, e) => a.search(e, media.title.slice(0, 100)), null)).groups;
    for (const g of others) {
      if (g.providerId === providerId) continue;
      const hit = g.items.find((i) => norm(i.title) === norm(media.title) && i.type === media.type);
      if (hit) result.alternatives.push({ providerId: g.providerId, name: g.name, mediaId: hit.id });
    }
  }
  return result;
});