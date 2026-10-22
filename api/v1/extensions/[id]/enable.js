import { db } from "hatchable";
import { handler, ApiError } from "lib/http.js";
import { toPublic } from "lib/service.js";
import { validateAnyManifest } from "lib/manifest.js";

export const access = "user";
export const methods = ["POST"];

// Enabling re-validates the stored manifest: an extension that no longer passes validation is marked failed, never run.
export default handler(async (req) => {
  const { rows } = await db.query("SELECT * FROM extensions WHERE id::text = $1 AND owner_id = $2", [req.params.id, req.user.id]);
  const ext = rows[0];
  if (!ext) throw new ApiError(404, "not_found", "Extension not found");
  const v = validateAnyManifest(ext.manifest);
  if (!v.ok) {
    const reason = v.unsupported || v.errors[0] || "Manifest failed validation";
    await db.query("UPDATE extensions SET status = $2, enabled = FALSE, last_error = $3, updated_at = now() WHERE id = $1", [ext.id, v.unsupported ? "unsupported" : "failed", reason.slice(0, 300)]);
    throw new ApiError(422, "invalid_manifest", reason, v.errors);
  }
  const r = await db.query("UPDATE extensions SET enabled = TRUE, status = 'installed', last_error = NULL, updated_at = now() WHERE id = $1 RETURNING *", [ext.id]);
  return toPublic(r.rows[0]);
});