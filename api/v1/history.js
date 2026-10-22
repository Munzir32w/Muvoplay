import { db } from "hatchable";
import { handler, validate, ApiError } from "lib/http.js";
import { safeUrlOrNull } from "lib/security.js";
import { splitId, MEDIA_TYPES } from "lib/normalize.js";
import { clip } from "lib/util.js";

export const access = "user";
export const methods = ["GET", "POST", "DELETE"];

const out = (r) => ({
  providerId: r.provider_id, mediaId: r.media_id, episodeId: r.episode_id || null, title: r.title, episodeTitle: r.episode_title, poster: r.poster,
  type: r.media_type, genres: r.genres || [], position: r.position_seconds, duration: r.duration_seconds, updatedAt: r.updated_at,
});

export default handler(async (req) => {
  const uid = req.user.id;
  if (req.method === "GET") {
    const q = req.query || {};
    if (q.mediaId) {
      const { rows } = await db.query("SELECT * FROM watch_history WHERE user_id = $1 AND media_id = $2 AND episode_id = $3", [uid, String(q.mediaId).slice(0, 600), String(q.episodeId || "").slice(0, 600)]);
      return { item: rows[0] ? out(rows[0]) : null };
    }
    const limit = Math.min(Math.max(parseInt(q.limit, 10) || 30, 1), 100);
    const { rows } = await db.query("SELECT * FROM watch_history WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2", [uid, limit]);
    const c = await db.query("SELECT count(*)::int AS n FROM watch_history WHERE user_id = $1", [uid]);
    return { total: c.rows[0].n, items: rows.map(out) };
  }
  if (req.method === "POST") {
    const b = validate(req.body, {
      mediaId: { type: "string", required: true, max: 600 }, episodeId: { type: "string", max: 600 },
      title: { type: "string", required: true, max: 200 }, episodeTitle: { type: "string", max: 200 },
      poster: { type: "string", max: 2048 }, type: { type: "string", enum: MEDIA_TYPES }, genres: { type: "array", items: "string", max: 12 },
      position: { type: "number", required: true, min: 0 }, duration: { type: "number", min: 0, default: 0 },
    });
    const s = splitId(b.mediaId);
    if (!s) throw new ApiError(400, "validation_error", "Invalid media id");
    await db.query(
      `INSERT INTO watch_history (user_id, provider_id, media_id, episode_id, title, episode_title, poster, media_type, genres, position_seconds, duration_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
       ON CONFLICT (user_id, media_id, episode_id) DO UPDATE SET title = EXCLUDED.title, episode_title = EXCLUDED.episode_title, poster = EXCLUDED.poster,
         media_type = EXCLUDED.media_type, genres = EXCLUDED.genres, position_seconds = EXCLUDED.position_seconds, duration_seconds = EXCLUDED.duration_seconds, updated_at = now()`,
      [uid, s.providerId, b.mediaId, b.episodeId || "", clip(b.title, 200), b.episodeTitle ? clip(b.episodeTitle, 200) : null, safeUrlOrNull(b.poster), b.type || "other",
        JSON.stringify((b.genres || []).map((g) => clip(g, 40))), Math.min(b.position, 1e6), Math.min(b.duration, 1e6)]);
    return { saved: true };
  }
  const q = req.query || {};
  const r = q.mediaId
    ? await db.query("DELETE FROM watch_history WHERE user_id = $1 AND media_id = $2 AND ($3 = '' OR episode_id = $3)", [uid, String(q.mediaId).slice(0, 600), String(q.episodeId || "").slice(0, 600)])
    : await db.query("DELETE FROM watch_history WHERE user_id = $1", [uid]);
  return { deleted: r.rowCount };
});