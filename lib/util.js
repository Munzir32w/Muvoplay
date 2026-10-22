export class AdapterError extends Error {
  constructor(message, code = "adapter_error", status = 502) { super(message); this.name = "AdapterError"; this.code = code; this.status = status; }
}

export const clip = (v, n) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, n);
export const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** SRT or WebVTT text -> WebVTT text, or null when it is neither. */
export function toVtt(text) {
  const t = String(text).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (/^WEBVTT/.test(t.trimStart())) return t;
  if (/^\s*\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3} --> /m.test(t)) return "WEBVTT\n\n" + t.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return null;
}

/** {baseUrl} is inserted raw (trailing slash trimmed); every other variable is URL-encoded. */
export function expandTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => {
    if (k === "baseUrl") return String(vars.baseUrl || "").replace(/\/+$/, "");
    return encodeURIComponent(String(vars[k] ?? ""));
  });
}

export function compareSemver(a, b) {
  const pa = String(a).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1; }
  return 0;
}

/** Run fn over items with a concurrency cap. Never throws; returns [{ok,value|error}]. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = { ok: true, value: await fn(items[idx], idx) }; }
      catch (error) { out[idx] = { ok: false, error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}