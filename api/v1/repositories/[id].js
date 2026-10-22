import { db } from "hatchable";
import { handler, ApiError } from "lib/http.js";

export const access = "user";
export const methods = ["DELETE"];

export default handler(async (req) => {
  const { rowCount } = await db.query("DELETE FROM repositories WHERE id::text = $1 AND owner_id = $2", [req.params.id, req.user.id]);
  if (!rowCount) throw new ApiError(404, "not_found", "Repository not found");
  return { deleted: true };
});