import { handler, validate, rateLimit } from "lib/http.js";
import { fanOut } from "lib/fanout.js";
import { MEDIA_TYPES } from "lib/normalize.js";

export const access = "user";
export const methods = ["POST"];

export default handler(async (req) => {
  const uid = req.user.id;
  const b = validate(req.body, {
    query: { type: "string", required: true, min: 1, max: 200 },
    providers: { type: "array", items: "string", max: 20 },
    type: { type: "string", enum: MEDIA_TYPES },
    year: { type: "int", min: 1880, max: 2100 },
    genre: { type: "string", max: 40 },
  });
  await rateLimit(uid, "scrape", 60);
  const { groups, errors, searched } = await fanOut(uid, "search", (a, e) => a.search(e, b.query), b.providers);
  let items = groups.flatMap((g) => g.items);
  if (b.type) items = items.filter((i) => i.type === b.type);
  if (b.year) items = items.filter((i) => i.year === b.year);
  if (b.genre) items = items.filter((i) => i.genres.some((g) => g.toLowerCase() === b.genre.toLowerCase()));
  const providers = groups.map((g) => ({ id: g.providerId, name: g.name, demo: g.demo, count: g.items.length }));
  return { query: b.query, searched, providers, errors, total: items.length, results: items.slice(0, 150) };
});