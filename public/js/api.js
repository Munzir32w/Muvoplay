const BASE = "/api/v1";

export class ApiErr extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function req(method, path, body, opts = {}) {
  let r;
  try {
    r = await fetch(BASE + path, { method, credentials: "same-origin", keepalive: !!opts.keepalive, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new ApiErr(0, "offline", "Could not reach the server. Check your connection."); }
  if (r.status === 401 || (r.redirected && /\/login/.test(r.url))) {
    location.href = "/login?next=" + encodeURIComponent(location.pathname + location.hash);
    throw new ApiErr(401, "unauthorized", "Please sign in");
  }
  let j = null;
  try { j = await r.json(); } catch {}
  if (!r.ok || !j || j.error) {
    const e = (j && j.error) || {};
    throw new ApiErr(r.status, e.code || "error", e.message || `Request failed (${r.status})`);
  }
  return j.data;
}

export const api = {
  get: (p) => req("GET", p),
  post: (p, b, o) => req("POST", p, b || {}, o),
  del: (p) => req("DELETE", p),
};