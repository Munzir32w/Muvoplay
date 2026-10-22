import { db } from "hatchable";
import { handler, rateLimit, ApiError } from "lib/http.js";
import { publicRepo, refreshRepository } from "lib/service.js";

export const access = "user";
export const methods = ["POST"];

export default handler(async (req) => {
  const uid = req.user.id;
  await rateLimit(uid, "repo", 20);
  const { rows } = await db.query("SELECT * FROM repositories WHERE id::text = $1 AND owner_id = $2", [req.params.id, uid]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Repository not found");
  return publicRepo(await refreshRepository(rows[0]));
});