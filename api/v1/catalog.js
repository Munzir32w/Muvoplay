import { handler, validate, rateLimit } from "lib/http.js";
import { fanOut } from "lib/fanout.js";

export const access = "user";
export const methods = ["POST"];

export default handler(async (req) => {
  const uid = req.user.id;
  const b = validate(req.body, {
    providers: { type: "array", items: "string", max: 20 },
    page: { type: "int", min: 1, max: 50, default: 1 },
    limit: { type: "int", min: 1, max: 48, default: 18 },
  });
  await rateLimit(uid, "scrape", 60);
  const { groups, errors, searched } = await fanOut(uid, "catalog", (a, e) => a.catalog(e, { page: b.page }), b.providers);
  return { searched, errors, page: b.page, sections: groups.map((g) => ({ providerId: g.providerId, name: g.name, demo: g.demo, items: g.items.slice(0, b.limit) })) };
});