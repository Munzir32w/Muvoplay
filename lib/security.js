// SSRF protection + guarded fetch. Every outbound request in Muvoplay goes through here.
// Note: the isolate cannot resolve DNS itself; hostnames are checked by name/IP-literal here,
// and resolved-IP filtering is enforced by Hatchable's egress proxy.

export class SecurityError extends Error {
  constructor(message) { super(message); this.name = "SecurityError"; this.status = 400; this.code = "unsafe_url"; }
}
export class FetchError extends Error {
  constructor(message, code = "fetch_failed") { super(message); this.name = "FetchError"; this.status = 502; this.code = code; }
}

const BLOCKED_NAMES = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data", "kubernetes.default"]);
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet", ".localdomain", ".home.arpa"];

export function isBlockedIPv4(a, b) {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function expandIPv6(input) {
  let s = input.toLowerCase();
  if (s.includes(".")) {
    const idx = s.lastIndexOf(":");
    const v4 = s.slice(idx + 1).split(".").map(Number);
    if (v4.length !== 4 || v4.some((n) => !(n >= 0 && n <= 255))) return null;
    s = s.slice(0, idx + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  let groups;
  if (parts.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  } else groups = head;
  if (groups.length !== 8) return null;
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

export function isBlockedIPv6(host) {
  const g = expandIPv6(host);
  if (!g) return true; // unparsable -> refuse
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. cloud metadata fd00:ec2::254)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedIPv4(g[6] >> 8, g[6] & 255); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedIPv4(g[6] >> 8, g[6] & 255); // NAT64
  if (g.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) return isBlockedIPv4(g[1] >> 8, g[1] & 255); // 6to4
  return false;
}

export function hostMatches(host, domains) {
  return domains.some((d) => host === d || host.endsWith("." + d));
}

function portAllowed(port) {
  if (port === "") return true;
  const n = Number(port);
  return n === 80 || n === 443 || (n >= 8000 && n <= 8999);
}

/** Validates a URL string. Throws SecurityError. Returns the parsed URL. */
export function assertSafeUrl(raw, opts = {}) {
  const { allowedDomains = null } = opts;
  const text = String(raw ?? "").trim();
  if (!text || text.length > 2048) throw new SecurityError("URL is empty or too long");
  let u;
  try { u = new URL(text); } catch { throw new SecurityError("URL is not valid"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SecurityError("Only http and https URLs are allowed");
  if (u.username || u.password) throw new SecurityError("URLs with credentials are not allowed");
  if (!portAllowed(u.port)) throw new SecurityError("Port is not allowed");
  let host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[")) host = host.slice(1, -1);
  if (host.includes(":")) {
    if (isBlockedIPv6(host)) throw new SecurityError("Target address is not allowed");
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (isBlockedIPv4(a, b)) throw new SecurityError("Target address is not allowed");
  } else {
    if (BLOCKED_NAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new SecurityError("Host is not allowed");
    if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) throw new SecurityError("Host is not allowed");
    if (/^\d+$/.test(host.split(".").pop())) throw new SecurityError("Host is not allowed");
  }
  if (allowedDomains && allowedDomains.length && !hostMatches(host, allowedDomains)) {
    throw new SecurityError(`Host ${host} is not in the allowed domains`);
  }
  return u;
}

export function safeUrlOrNull(raw, opts) {
  try { return assertSafeUrl(raw, opts).href; } catch { return null; }
}

async function readLimited(res, max) {
  const cl = Number(res.headers.get("content-length") || 0);
  if (cl > max) throw new FetchError("Response is too large", "too_large");
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let total = 0, out = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { try { await reader.cancel(); } catch {} throw new FetchError("Response is too large", "too_large"); }
      out += dec.decode(value, { stream: true });
    }
    return out + dec.decode();
  }
  const text = await res.text();
  if (text.length > max) throw new FetchError("Response is too large", "too_large");
  return text;
}

/**
 * Guarded fetch: validates every hop (redirects are followed manually), enforces timeout,
 * redirect count and body size. Never logs full URLs (they may carry tokens).
 */
export async function safeFetch(raw, o = {}) {
  const { allowedDomains = null, timeoutMs = 8000, maxBytes = 1500000, maxRedirects = 3, headers = {}, method = "GET", accept = "*/*" } = o;
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = assertSafeUrl(current, { allowedDomains });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(u.href, {
        method, redirect: "manual", signal: ctrl.signal,
        headers: { "user-agent": "Muvoplay/0.1 (+extension-scraper)", accept, ...headers },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new FetchError(e && e.name === "AbortError" ? `Request to ${u.hostname} timed out` : `Could not reach ${u.hostname}`, e && e.name === "AbortError" ? "timeout" : "unreachable");
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      clearTimeout(timer);
      current = new URL(loc, u).href;
      continue;
    }
    try {
      if (o.noBody) { try { if (res.body && res.body.cancel) await res.body.cancel(); } catch {} }
      const text = method === "HEAD" || o.noBody ? "" : await readLimited(res, maxBytes);
      return { url: u.href, status: res.status, ok: res.status >= 200 && res.status < 300, headers: res.headers, contentType: (res.headers.get("content-type") || "").toLowerCase(), text };
    } finally { clearTimeout(timer); }
  }
  throw new FetchError("Too many redirects", "too_many_redirects");
}