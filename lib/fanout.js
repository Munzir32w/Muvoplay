import { db } from "hatchable";
import { pool, clip } from "lib/util.js";
import { listExtensions } from "lib/service.js";
import { adapterFor } from "lib/adapters/index.js";

/** Runs one capability across enabled extensions (max 8, 4 at a time). Returns grouped results plus per-extension errors. */
export async function fanOut(userId, cap, call, providers) {
  let rows = (await listExtensions(userId)).filter((e) => e.enabled && e.status === "installed" && (e.manifest.capabilities || []).includes(cap));
  if (providers && providers.length) rows = rows.filter((e) => providers.includes(e.extension_key));
  rows = rows.slice(0, 8);
  const res = await pool(rows, 4, async (e) => call(adapterFor(e.format), e));
  const groups = []; const errors = [];
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i], r = res[i];
    if (r.ok) groups.push({ providerId: e.extension_key, name: e.name, demo: e.manifest.demo === true, items: r.value });
    else {
      const msg = clip(r.error && r.error.message, 200) || "Failed";
      errors.push({ providerId: e.extension_key, name: e.name, code: (r.error && r.error.code) || "error", message: msg });
      await db.query("UPDATE extensions SET last_error = $2 WHERE id = $1", [e.id, msg]);
    }
  }
  return { groups, errors, searched: rows.length };
}