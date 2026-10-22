// DOM helpers. Nothing here uses innerHTML, so text from extensions can never become markup.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  add(el, kids);
  return el;
}
export function add(el, kids) {
  for (const k of [kids].flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

const ICONS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10", search: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.5-4.5", puzzle: "M10 4a2 2 0 114 0v2h4v4h-2a2 2 0 100 4h2v4H4v-4h2a2 2 0 100-4H4V6h6z",
  repo: "M4 5c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2zM4 5v14c0 1.1 3.6 2 8 2s8-.9 8-2V5M4 12c0 1.1 3.6 2 8 2s8-.9 8-2",
  settings: "M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14 3h-4l-.6 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2 1.2L10 21h4l.6-2.6c.7-.3 1.4-.7 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
  play: "M7 4l13 8-13 8z", pause: "M7 4h4v16H7zM13 4h4v16h-4z", prev: "M6 5v14M20 5L9 12l11 7z", next: "M18 5v14M4 5l11 7-11 7z",
  vol: "M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12", mute: "M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6",
  full: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5", heart: "M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3", refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7", plus: "M12 5v14M5 12h14", check: "M5 12l5 5 9-10", x: "M6 6l12 12M18 6L6 18",
  link: "M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1", book: "M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6", logout: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9",
};
export function icon(name, size = 20) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: "0 0 24 24", fill: name === "play" || name === "pause" ? "currentColor" : (name === "heart" ? "none" : "none"), stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  const p = document.createElementNS(ns, "path"); p.setAttribute("d", ICONS[name] || ""); svg.append(p);
  return svg;
}

export function toast(msg, kind = "") {
  let box = document.getElementById("toasts");
  if (!box) { box = h("div", { id: "toasts", role: "status", "aria-live": "polite" }); document.body.append(box); }
  const t = h("div", { class: "toast " + kind }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === "bad" ? 6000 : 3500);
}

export function modal({ title, body, actions }) {
  return new Promise((resolve) => {
    const close = (v) => { ov.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") close(null); };
    const acts = (actions || []).map((a) => h("button", { class: "btn " + (a.class || ""), onclick: () => close(a.value) }, a.label));
    const ov = h("div", { class: "overlay", onclick: (e) => { if (e.target === ov) close(null); } }, h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title }, h("h2", null, title), body, h("div", { class: "actions" }, acts)));
    document.body.append(ov);
    document.addEventListener("keydown", onKey);
    const first = ov.querySelector("input, textarea, .btn-primary, .btn"); if (first) first.focus();
    ov._close = close;
  });
}
export const confirmBox = (title, text, label = "Confirm", danger = false) =>
  modal({ title, body: h("p", { class: "muted" }, text), actions: [{ label: "Cancel", value: false }, { label, value: true, class: danger ? "btn-danger" : "btn-primary" }] });

export const spinner = () => h("div", { class: "state" }, h("div", { class: "spinner", role: "progressbar", "aria-label": "Loading" }));
export const emptyState = (title, text, ...actions) => h("div", { class: "state" }, h("h3", null, title), text && h("p", null, text), actions.length ? h("div", { class: "row", style: "justify-content:center" }, actions) : null);
export const errorState = (msg, retry) => h("div", { class: "state err" }, h("h3", null, "Something went wrong"), h("p", null, msg), retry && h("button", { class: "btn", onclick: retry }, icon("refresh", 16), "Try again"));
export const skeletons = (n = 8) => h("div", { class: "grid" }, Array.from({ length: n }, () => h("div", { class: "skel" })));

export const mediaHref = (id) => "#/media/" + encodeURIComponent(id);
export const watchHref = (mediaId, episodeId) => "#/watch/" + encodeURIComponent(mediaId) + (episodeId ? "/" + encodeURIComponent(episodeId) : "");

export function mediaCard(item, extra = {}) {
  const poster = h("div", { class: "mposter" });
  const ph = h("div", { class: "ph" }, item.title);
  poster.append(ph);
  if (item.poster) {
    const img = h("img", { src: item.poster, alt: "", loading: "lazy", referrerpolicy: "no-referrer", decoding: "async" });
    img.addEventListener("load", () => ph.remove());
    img.addEventListener("error", () => img.remove());
    poster.append(img);
  }
  const tags = h("div", { class: "tags" });
  if (item.demo) tags.append(h("span", { class: "badge badge-demo" }, "Demo"));
  if (item.type && item.type !== "other") tags.append(h("span", { class: "badge" }, item.type));
  poster.append(tags);
  if (extra.progress) poster.append(h("div", { class: "bar" }, h("i", { style: `width:${Math.round(extra.progress * 100)}%` })));
  return h("a", { class: "mcard", href: extra.href || mediaHref(item.id) }, poster, h("div", { class: "mtitle" }, item.title), h("div", { class: "msub" }, extra.sub ?? [item.year, (item.genres || []).slice(0, 2).join(", ")].filter(Boolean).join(" · ")));
}

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const h2 = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return (h2 ? h2 + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
}
export function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago"; if (s < 86400) return Math.floor(s / 3600) + " h ago"; return Math.floor(s / 86400) + " d ago";
}