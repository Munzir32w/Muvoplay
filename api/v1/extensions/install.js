import { db } from "hatchable";
import { handler, validate, rateLimit, ApiError } from "lib/http.js";
import { toPublic, resolveFromJson, resolveFromUrl, installManifest } from "lib/service.js";
import { BUILTINS } from "lib/demo.js";

export const access = "user";
export const methods = ["POST"];

const UUID = /^[0-9a-f-]{36}$/i;

export default handler(async (req) => {
  const uid = req.user.id;
  const b = validate(req.body, {
    builtin: { type: "string", max: 64 },
    repositoryId: { type: "string", pattern: UUID },
    extensionKey: { type: "string", max: 64 },
    manifestUrl: { type: "string", max: 2048 },
    manifest: { type: "object" },
  });
  const modes = [b.builtin, b.repositoryId && b.extensionKey, b.manifestUrl, b.manifest].filter(Boolean).length;
  if (modes !== 1) throw new ApiError(400, "validation_error", "Provide exactly one of: builtin, repositoryId + extensionKey, manifestUrl, manifest");
  await rateLimit(uid, "install", 20);
  const { rows: cnt } = await db.query("SELECT count(*)::int AS n FROM extensions WHERE owner_id = $1", [uid]);
  if (cnt[0].n >= 50) throw new ApiError(409, "limit_reached", "You can install at most 50 extensions");

  let manifest, repositoryId = null, sourceUrl = null;
  if (b.builtin) {
    const m = BUILTINS[b.builtin];
    if (!m) throw new ApiError(404, "not_found", "Unknown built-in extension");
    manifest = resolveFromJson(m);
  } else if (b.repositoryId) {
    const { rows } = await db.query("SELECT * FROM repositories WHERE id = $1 AND owner_id = $2", [b.repositoryId, uid]);
    if (!rows[0]) throw new ApiError(404, "not_found", "Repository not found");
    const entry = (rows[0].index_data || []).find((e) => e.key === b.extensionKey);
    if (!entry) throw new ApiError(404, "not_found", "Extension not found in this repository. Refresh the repository and try again.");
    if (entry.status !== "ok") throw new ApiError(422, entry.status === "unsupported" ? "unsupported_format" : "invalid_manifest", entry.reason || "This entry cannot be installed");
    repositoryId = rows[0].id;
    if (entry.manifest) manifest = resolveFromJson(entry.manifest);
    else { sourceUrl = entry.manifestUrl; manifest = await resolveFromUrl(entry.manifestUrl); }
    if (manifest.id !== entry.key) throw new ApiError(422, "invalid_manifest", "The manifest id does not match its repository entry");
  } else if (b.manifestUrl) {
    sourceUrl = b.manifestUrl;
    manifest = await resolveFromUrl(b.manifestUrl);
  } else {
    manifest = resolveFromJson(b.manifest);
  }
  const row = await installManifest(uid, manifest, { repositoryId, sourceUrl });
  return toPublic(row);
});