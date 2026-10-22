import { h, clear, icon, toast, spinner, errorState, watchHref } from "/js/ui.js";
import { api } from "/js/api.js";
import { createPlayer } from "/js/player.js";
import { settings } from "/js/store.js";

export async function render(root, ctx, alive) {
  const mediaId = ctx.args[0], episodeId = ctx.args[1] || "";
  if (!mediaId) { location.hash = "#/"; return; }
  const holder = h("div", { class: "stack-sm" }, spinner());
  root.append(h("div", { class: "watch" }, h("a", { href: "javascript:history.back()", class: "btn btn-sm btn-ghost", style: "justify-self:start" }, "← Back"), holder));
  let player = null, last = 0, closed = false;
  const target = episodeId || mediaId;

  async function boot(reload) {
    clear(holder).append(spinner());
    if (player) { player.destroy(); player = null; }
    let details, eps = [], streams, saved = null;
    try {
      const [d, st, hs] = await Promise.all([
        api.post("/media/details", { mediaId }),
        api.post("/media/streams", { id: target, mediaId, probe: true }),
        api.get(`/history?mediaId=${encodeURIComponent(mediaId)}&episodeId=${encodeURIComponent(episodeId)}`).catch(() => ({ item: null })),
      ]);
      details = d; streams = st; saved = hs.item;
      if (episodeId && d.provider.capabilities.includes("episodes")) eps = (await api.post("/media/episodes", { mediaId }).catch(() => ({ episodes: [] }))).episodes;
    } catch (e) {
      if (!alive()) return;
      clear(holder).append(errorState(e.message + (e.code === "drm_protected" || e.code === "auth_required" || e.code === "requires_javascript" ? " (Muvoplay does not bypass this.)" : ""), () => boot()));
      return;
    }
    if (!alive() || closed) return;
    const m = details.media;
    const idx = eps.findIndex((e) => e.id === episodeId), ep = idx >= 0 ? eps[idx] : null;
    const prev = idx > 0 ? eps[idx - 1] : null, next = idx >= 0 && idx < eps.length - 1 ? eps[idx + 1] : null;
    root.dataset.title = m.title; document.title = (ep ? ep.title + " · " : "") + m.title + " · Muvoplay";

    const notice = h("div");
    const save = ({ position, duration }) => {
      if (!alive() || closed || position < 5 || Date.now() - last < 4000) return;
      last = Date.now();
      api.post("/history", { mediaId, episodeId: episodeId || undefined, title: m.title, episodeTitle: ep ? ep.title : undefined, poster: m.poster || undefined, type: m.type, genres: m.genres, position, duration }, { keepalive: true }).catch(() => {});
    };
    player = createPlayer({
      providerId: details.provider.id, onProgress: save, onNotice: (t) => toast(t, "bad"),
      onPrev: prev ? () => (location.hash = watchHref(mediaId, prev.id)) : null,
      onNext: next ? () => (location.hash = watchHref(mediaId, next.id)) : null,
      onEnded: () => { if (next && settings().autoplayNext) location.hash = watchHref(mediaId, next.id); },
      onReloadSources: () => boot(true),
    });
    clear(holder).append(player.el, h("div", { class: "stack-sm" },
      h("div", { class: "row" }, h("h1", null, m.title), details.provider.demo ? h("span", { class: "badge badge-demo" }, "Demo") : null),
      ep ? h("h2", { class: "muted" }, ep.title) : null,
      h("div", { class: "small muted" }, "Source: ", details.provider.name, " · ", h("a", { href: "#/media/" + encodeURIComponent(mediaId), style: "text-decoration:underline" }, "Details")),
      notice, sourceInfo(streams)));
    if (!streams.sources.length) {
      notice.append(h("div", { class: "notice bad" }, "This provider returned no playable sources." + (streams.rejected.length ? " " + streams.rejected[0].reason + "." : "")));
      return;
    }
    let startPos = saved && settings().resume && saved.duration && saved.position > 5 && saved.position < saved.duration - 15 ? saved.position : 0;
    if (!saved || !settings().resume) startPos = 0;
    if (startPos) notice.append(h("div", { class: "muted small" }, "Resuming from " + Math.floor(startPos / 60) + ":" + String(Math.floor(startPos % 60)).padStart(2, "0")));
    player.setSources(streams.sources, startPos);
  }
  await boot();
  return () => { closed = true; if (player) player.destroy(); };
}

function sourceInfo(st) {
  const bad = st.sources.filter((s) => s.check && s.check.playable === false), notes = st.rejected || [];
  if (!bad.length && !notes.length) return null;
  return h("details", { class: "box" }, h("summary", null, `Source diagnostics (${bad.length + notes.length})`),
    h("ul", { class: "small muted" }, bad.map((s) => h("li", null, `${s.type.toUpperCase()}${s.quality ? " " + s.quality : ""}: ${s.check.reason}`)), notes.slice(0, 20).map((r) => h("li", null, `Skipped: ${r.reason}`))));
}