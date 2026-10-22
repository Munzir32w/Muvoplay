import { handler, validate, rateLimit, ApiError } from "lib/http.js";
import { db } from "hatchable";
import { toPublic, listExtensions, compareSemver } from "lib/service.js";
import { BUILTINS } from "lib/demo.js";

export const access = "user";
export const methods = ["GET"];

export default handler(async (req) => {
  const uid = req.user.id;
  const rows = await listExtensions(uid);
  const installed = rows.map(toPublic);
  const byKey = new Map(rows.map((r) => [r.extension_key, r]));
  const { rows: repos } = await db.query("SELECT id, name, index_data FROM repositories WHERE owner_id = $1 AND enabled = TRUE ORDER BY created_at", [uid]);
  const available = []; const updates = [];
  for (const repo of repos) {
    for (const e of repo.index_data || []) {
      const inst = byKey.get(e.key);
      const item = {
        repositoryId: repo.id, repositoryName: repo.name, key: e.key, name: e.name, version: e.version || null, description: e.description || "", author: e.author || "",
        format: e.format || "muvoplay-json", capabilities: e.capabilities || [], permissions: e.permissions || [], status: e.status, reason: e.reason || null,
        installed: !!inst, installedVersion: inst ? inst.version : null,
      };
      available.push(item);
      if (inst && e.status === "ok" && e.version && inst.repository_id === repo.id && compareSemver(e.version, inst.version) > 0) updates.push({ ...item, extensionId: inst.id });
    }
  }
  const builtin = Object.values(BUILTINS).map((m) => ({ key: m.id, name: m.name, version: m.version, description: m.description, demo: true, format: m.format, capabilities: m.capabilities, permissions: m.permissions, installed: byKey.has(m.id) }));
  return { installed, available, updates, builtin };
});