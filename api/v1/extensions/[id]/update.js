import { db } from "hatchable";
import { handler, rateLimit, ApiError } from "lib/http.js";
import { toPublic, resolveFromJson, resolveFromUrl, installManifest } from "lib/service.js";
import { BUILTINS } from "lib/demo.js";

export const access = "user";
export const methods = ["POST"];

// Re-installs from the extension's recorded source (repository index, manifest URL or built-in). Keeps enabled state.
export default handler(async (req) => {
  const uid = req.user.id;
  await rateLimit(uid, "install", 20);
  const { rows } = await db.query("SELECT * FROM extensions WHERE id::text = $1 AND owner_id = $2", [req.params.id, uid]);
  const ext = rows[0];
  if (!ext) throw new ApiError(404, "not_found", "Extension not found");
  let manifest, repositoryId = ext.repository_id, sourceUrl = ext.source_url;
  if (ext.repository_id) {
    const r = await db.query("SELECT index_data FROM repositories WHERE id = $1 AND owner_id = $2", [ext.repository_id, uid]);
    const entry = r.rows[0] && (r.rows[0].index_data || []).find((e) => e.key === ext.extension_key);
    if (!entry || entry.status !== "ok") throw new ApiError(404, "not_found", "The repository no longer lists a valid version. Refresh the repository first.");
    if (entry.manifest) manifest = resolveFromJson(entry.manifest);
    else { sourceUrl = entry.manifestUrl; manifest = await resolveFromUrl(entry.manifestUrl); }
  } else if (ext.source_url) manifest = await resolveFromUrl(ext.source_url);
  else if (BUILTINS[ext.extension_key]) manifest = resolveFromJson(BUILTINS[ext.extension_key]);
  else throw new ApiError(409, "no_source", "This extension has no recorded source to update from");
  if (manifest.id !== ext.extension_key) throw new ApiError(422, "invalid_manifest", "The updated manifest has a different id");
  const row = await installManifest(uid, manifest, { repositoryId, sourceUrl });
  return toPublic(row);
});