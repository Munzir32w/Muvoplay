import { h, clear, spinner, errorState } from "/js/ui.js";

const DOCS = [["README", "/docs/README.md"], ["Extension format", "/docs/EXTENSIONS.md"], ["API", "/docs/API.md"]];

// Tiny safe markdown renderer: headings, fenced code, lists, paragraphs, inline code. Text only, no HTML injection.
function md(src) {
  const out = h("div", { class: "doc" }); const lines = src.split("\n"); let i = 0;
  const inline = (t) => { const parts = t.split(/(`[^`]+`)/g); return parts.map((p) => (p.startsWith("`") && p.endsWith("`") && p.length > 2 ? h("code", null, p.slice(1, -1)) : p.replace(/\*\*/g, ""))); };
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("```")) { const buf = []; i++; while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]); i++; out.append(h("pre", null, h("code", null, buf.join("\n")))); continue; }
    const hm = l.match(/^(#{1,3})\s+(.*)/); if (hm) { out.append(h("h" + hm[1].length, null, inline(hm[2]))); i++; continue; }
    if (/^\s*[-*]\s+/.test(l)) { const ul = h("ul"); while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) ul.append(h("li", null, inline(lines[i++].replace(/^\s*[-*]\s+/, "")))); out.append(ul); continue; }
    if (!l.trim()) { i++; continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^(#{1,3}\s|\s*[-*]\s)/.test(lines[i])) buf.push(lines[i++]);
    out.append(h("p", null, inline(buf.join(" "))));
  }
  return out;
}

export async function render(root) {
  root.dataset.title = "Docs";
  const body = h("div"); let cur = 0;
  const tabs = h("div", { class: "tabs" });
  const draw = async () => {
    clear(tabs).append(DOCS.map(([l], k) => h("button", { class: "tab" + (k === cur ? " active" : ""), onclick: () => { cur = k; draw(); } }, l)));
    clear(body).append(spinner());
    try { const r = await fetch(DOCS[cur][1]); if (!r.ok) throw new Error("Document not found"); clear(body).append(md(await r.text())); } catch (e) { clear(body).append(errorState(e.message, draw)); }
  };
  root.append(h("div", { style: "max-width:820px" }, h("h1", null, "Documentation"), tabs, body));
  await draw();
}