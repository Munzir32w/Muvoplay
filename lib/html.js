// Small dependency-free HTML parser and CSS selector engine (Hatchable has no npm install).
// Selector support: tag, *, #id, .class, [attr], [attr=v] [attr^=v] [attr$=v] [attr*=v] [attr~=v],
// descendant (space) and child (>) combinators, comma groups, :first-child, :last-child, :nth-child(n).

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);
const MAX_NODES = 60000;

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; } catch { return m; } }
  return ENT[e.toLowerCase()] ?? m;
});

function parseAttrs(s) {
  const attrs = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s || ""))) { const k = m[1].toLowerCase(); if (!(k in attrs)) attrs[k] = decode(m[2] ?? m[3] ?? m[4] ?? ""); }
  return attrs;
}

export function parseHtml(src) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  const stack = [root]; let cur = root; let count = 0; let last = 0; let m;
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
  const text = (t) => { if (t) cur.children.push({ text: t, parent: cur }); };
  while ((m = re.exec(src))) {
    if (++count > MAX_NODES) break;
    if (m.index > last) text(src.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) {
      const t = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === t) { stack.length = i; cur = stack[i - 1]; break; }
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const el = { tag, attrs: parseAttrs(m[3]), children: [], parent: cur };
      cur.children.push(el);
      if (RAW.has(tag) && !m[4]) {
        const close = new RegExp("</" + tag + "\\s*>", "ig"); close.lastIndex = last;
        const cm = close.exec(src); const end = cm ? cm.index : src.length;
        el.children.push({ text: src.slice(last, end), parent: el });
        last = cm ? cm.index + cm[0].length : src.length; re.lastIndex = last;
        continue;
      }
      if (!VOID.has(tag) && !m[4]) { stack.push(el); cur = el; }
    }
  }
  if (last < src.length) text(src.slice(last));
  return root;
}

export function textOf(node) {
  let out = "";
  const walk = (n) => {
    if (n.text !== undefined) { out += decode(n.text); return; }
    if (n.tag === "script" || n.tag === "style") return;
    for (const c of n.children) walk(c);
    if (/^(p|div|br|li|h[1-6])$/.test(n.tag)) out += " ";
  };
  walk(node);
  return out.replace(/\s+/g, " ").trim();
}

/* ---------------- selectors ---------------- */
function parseCompound(s, pos) {
  const c = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  const ident = /[\w-]+/y;
  let i = pos; let any = false;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "*") { i++; any = true; continue; }
    if (ch === "#" || ch === ".") { ident.lastIndex = i + 1; const m = ident.exec(s); if (!m) throw new Error("Bad selector"); if (ch === "#") c.id = m[0]; else c.classes.push(m[0]); i = ident.lastIndex; any = true; continue; }
    if (ch === "[") {
      const m = /\[\s*([\w:-]+)\s*(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]/y; m.lastIndex = i;
      const r = m.exec(s); if (!r) throw new Error("Bad attribute selector");
      c.attrs.push({ name: r[1].toLowerCase(), op: r[2] || null, val: r[3] ?? r[4] ?? r[5] ?? "" }); i = m.lastIndex; any = true; continue;
    }
    if (ch === ":") {
      const m = /:([\w-]+)(?:\(([^)]*)\))?/y; m.lastIndex = i;
      const r = m.exec(s); if (!r || !["first-child", "last-child", "nth-child"].includes(r[1])) throw new Error("Unsupported pseudo-class");
      c.pseudos.push({ name: r[1], arg: r[2] }); i = m.lastIndex; any = true; continue;
    }
    if (/[a-zA-Z]/.test(ch) && !any && !c.tag) { ident.lastIndex = i; const m = ident.exec(s); c.tag = m[0].toLowerCase(); i = ident.lastIndex; any = true; continue; }
    break;
  }
  if (!any) throw new Error("Bad selector");
  return [c, i];
}

const cache = new Map();
function parseSelector(sel) {
  if (cache.has(sel)) return cache.get(sel);
  if (sel.length > 200) throw new Error("Selector too long");
  const groups = sel.split(",").map((g) => g.trim()).filter(Boolean).map((g) => {
    const chain = []; let i = 0; let comb = " ";
    while (i < g.length) {
      while (g[i] === " ") i++;
      if (g[i] === ">") { comb = ">"; i++; while (g[i] === " ") i++; }
      else if (g[i] === "+" || g[i] === "~") throw new Error("Sibling combinators are not supported");
      const [c, next] = parseCompound(g, i);
      chain.push({ c, comb: chain.length ? comb : null }); comb = " "; i = next;
    }
    if (!chain.length) throw new Error("Empty selector");
    return chain;
  });
  if (!groups.length) throw new Error("Empty selector");
  cache.set(sel, groups);
  return groups;
}

function siblings(el) { return el.parent ? el.parent.children.filter((n) => n.tag) : [el]; }
function matchCompound(el, c) {
  if (!el.tag || el.tag === "#root") return false;
  if (c.tag && el.tag !== c.tag) return false;
  if (c.id && el.attrs.id !== c.id) return false;
  if (c.classes.length) { const cl = (el.attrs.class || "").split(/\s+/); if (!c.classes.every((k) => cl.includes(k))) return false; }
  for (const a of c.attrs) {
    const v = el.attrs[a.name];
    if (v === undefined) return false;
    if (a.op === "=" && v !== a.val) return false;
    if (a.op === "^=" && !v.startsWith(a.val)) return false;
    if (a.op === "$=" && !v.endsWith(a.val)) return false;
    if (a.op === "*=" && !v.includes(a.val)) return false;
    if (a.op === "~=" && !v.split(/\s+/).includes(a.val)) return false;
  }
  for (const p of c.pseudos) {
    const sib = siblings(el); const idx = sib.indexOf(el);
    if (p.name === "first-child" && idx !== 0) return false;
    if (p.name === "last-child" && idx !== sib.length - 1) return false;
    if (p.name === "nth-child" && idx + 1 !== parseInt(p.arg, 10)) return false;
  }
  return true;
}
function matchChain(el, chain, idx) {
  if (!matchCompound(el, chain[idx].c)) return false;
  if (idx === 0) return true;
  if (chain[idx].comb === ">") return !!el.parent && matchChain(el.parent, chain, idx - 1);
  for (let p = el.parent; p && p.tag !== "#root"; p = p.parent) if (matchChain(p, chain, idx - 1)) return true;
  return false;
}

export function selectAll(scope, selector, limit = 5000) {
  const groups = parseSelector(selector);
  const out = [];
  const walk = (n) => {
    for (const ch of n.children) {
      if (!ch.tag) continue;
      if (groups.some((g) => matchChain(ch, g, g.length - 1))) { out.push(ch); if (out.length >= limit) return; }
      walk(ch);
      if (out.length >= limit) return;
    }
  };
  walk(scope);
  return out;
}
export const selectOne = (scope, selector) => selectAll(scope, selector, 1)[0] || null;