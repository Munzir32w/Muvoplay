import { db } from "hatchable";
import { handler, ApiError } from "lib/http.js";
import { toPublic } from "lib/service.js";

export const access = "user";
export const methods = ["POST"];

export default handler(async (req) => {
  const { rows } = await db.query("UPDATE extensions SET enabled = FALSE, updated_at = now() WHERE id::text = $1 AND owner_id = $2 RETURNING *", [req.params.id, req.user.id]);
  if (!rows[0]) throw new ApiError(404, "not_found", "Extension not found");
  return toPublic(rows[0]);
});