import { db } from "hatchable";
import { assertSafeUrl } from "lib/security.js";

export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

/** Wraps a handler: returns {data} on success, {error:{code,message}} on failure. Never leaks internals. */
export function handler(fn) {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      return res.json({ data: out === undefined ? null : out });
    } catch (e) {
      if (e instanceof ApiError || (e && e.status && e.code)) {
        return res.status(e.status).json({ error: { code: e.code, message: String(e.message).slice(0, 300), details: e.details } });
      }
      console.error("unhandled:", e && e.name, String((e && e.message) || e).slice(0, 200));
      return res.status(500).json({ error: { code: "internal_error", message: "Something went wrong on the server" } });
    }
  };
}

/** Minimal schema validation. spec: {field:{type,required,min,max,enum,pattern,default,items}} */
export function validate(input, spec) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const out = {}; const errs = [];
  for (const [k, s] of Object.entries(spec)) {
    let v = body[k];
    if (v === undefined || v === null || v === "") {
      if (s.required) errs.push(`${k} is required`);
      else if (s.default !== undefined) out[k] = s.default;
      continue;
    }
    if (s.type === "string") {
      if (typeof v !== "string") { errs.push(`${k} must be a string`); continue; }
      v = v.trim();
      if (s.min && v.length < s.min) errs.push(`${k} is too short`);
      if (s.max && v.length > s.max) errs.push(`${k} is too long`);
      if (s.pattern && !s.pattern.test(v)) errs.push(`${k} has an invalid format`);
      if (s.enum && !s.enum.includes(v)) errs.push(`${k} must be one of: ${s.enum.join(", ")}`);
    } else if (s.type === "int") {
      v = Number(v);
      if (!Number.isInteger(v)) { errs.push(`${k} must be an integer`); continue; }
      if (s.min !== undefined && v < s.min) errs.push(`${k} must be >= ${s.min}`);
      if (s.max !== undefined && v > s.max) errs.push(`${k} must be <= ${s.max}`);
    } else if (s.type === "number") {
      v = Number(v);
      if (!Number.isFinite(v)) { errs.push(`${k} must be a number`); continue; }
      if (s.min !== undefined && v < s.min) errs.push(`${k} must be >= ${s.min}`);
    } else if (s.type === "boolean") {
      if (typeof v !== "boolean") { errs.push(`${k} must be a boolean`); continue; }
    } else if (s.type === "array") {
      if (!Array.isArray(v)) { errs.push(`${k} must be an array`); continue; }
      if (s.max && v.length > s.max) errs.push(`${k} has too many items`);
      if (s.items === "string" && v.some((x) => typeof x !== "string" || x.length > 300)) errs.push(`${k} must contain short strings`);
    } else if (s.type === "object") {
      if (typeof v !== "object" || Array.isArray(v)) { errs.push(`${k} must be an object`); continue; }
    } else if (s.type === "url") {
      try { v = assertSafeUrl(v).href; } catch (e) { errs.push(`${k}: ${e.message}`); continue; }
    }
    out[k] = v;
  }
  if (errs.length) throw new ApiError(400, "validation_error", errs[0], errs);
  return out;
}

/** Per-user fixed-window rate limit (per minute), stored in Postgres so it holds across isolates. */
export async function rateLimit(userId, bucket, max) {
  const key = `${userId}:${bucket}`;
  const { rows } = await db.query(
    "INSERT INTO rate_limits (bucket, window_start, hits) VALUES ($1, date_trunc('minute', now()), 1) ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1 RETURNING hits",
    [key]
  );
  if (rows[0].hits > max) throw new ApiError(429, "rate_limited", "Too many requests. Please wait a minute and try again.");
  if (Math.random() < 0.02) await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 hour'");
}