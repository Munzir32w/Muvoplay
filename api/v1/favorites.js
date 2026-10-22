import { db } from "hatchable";
import { handler, validate, ApiError } from "lib/http.js";
import { safeUrlOrNull } from "lib/security.js";
import { splitId, MEDIA_TYPES } from "lib/normalize.js";
import { clip } from "lib/util.js";

export const access = "user";
export const methods = ["GET", "POST", "DELETE"];

const out = (r) => ({ providerId: r.provider_id, mediaId: r.media_id, title: r.title, poster: r.poster, type: r.media_type, genres: r.genres || [], createdAt: r.created_at });

export default handler(async (req) => {
  const uid = req.user.id;
  if (req.method === "GET") {
    const { rows } = await db.query("SELECT * FROM favorites WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200", [uid]);
    return { items: rows.map(out) };
  }
  if (req.method === "POST") {
    const b = validate(req.body, {
      mediaId: { type: "string", required: true, max: 600 }, title: { type: "string", required: true, max: 200 },
      poster: { type: "string", max: 2048 }, type: { type: "string", enum: MEDIA_TYPES }, genres: { type: "array", items: "string", max: 12 },
    });
    const s = splitId(b.mediaId);
    if (!s) throw new ApiError(400, "validation_error", "Invalid media id");
    await db.query(
      "INSERT INTO favorites (user_id, provider_id, media_id, title, poster, media_type, genres) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (user_id, media_id) DO NOTHING",
      [uid, s.providerId, b.mediaId, clip(b.title, 200), safeUrlOrNull(b.poster), b.type || "other", JSON.stringify((b.genres || []).map((g) => clip(g, 40)))]);
    return { saved: true };
  }
  const mediaId = String((req.query || {}).mediaId || "").slice(0, 600);
  if (!mediaId) throw new ApiError(400, "validation_error", "mediaId is required");
  const r = await db.query("DELETE FROM favorites WHERE user_id = $1 AND media_id = $2", [uid, mediaId]);
  return { deleted: r.rowCount };
});