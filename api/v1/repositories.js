import { db } from "hatchable";
import { handler, validate, rateLimit, ApiError } from "lib/http.js";
import { publicRepo, refreshRepository } from "lib/service.js";
import { assertSafeUrl } from "lib/security.js";

export const access = "user";
export const methods = ["GET", "POST"];

export default handler(async (req) => {
  const uid = req.user.id;
  if (req.method === "GET") {
    const { rows } = await db.query("SELECT * FROM repositories WHERE owner_id = $1 ORDER BY created_at", [uid]);
    return rows.map(publicRepo);
  }
  const b = validate(req.body, { url: { type: "string", required: true, max: 2048 }, name: { type: "string", max: 80 } });
  const url = assertSafeUrl(b.url).href;
  await rateLimit(uid, "repo", 20);
  const { rows: cnt } = await db.query("SELECT count(*)::int AS n FROM repositories WHERE owner_id = $1", [uid]);
  if (cnt[0].n >= 20) throw new ApiError(409, "limit_reached", "You can add at most 20 repositories");
  const host = new URL(url).hostname;
  let repo;
  try {
    const r = await db.query("INSERT INTO repositories (owner_id, name, url) VALUES ($1, $2, $3) RETURNING *", [uid, b.name || host, url]);
    repo = r.rows[0];
  } catch (e) {
    if (/unique|duplicate/i.test(String(e.message))) throw new ApiError(409, "duplicate", "This repository is already added");
    throw e;
  }
  // Validate immediately: a repository that cannot be read or has no valid index is rejected and not kept.
  try { repo = await refreshRepository(repo); }
  catch (e) {
    await db.query("DELETE FROM repositories WHERE id = $1", [repo.id]);
    throw e;
  }
  return publicRepo(repo);
});