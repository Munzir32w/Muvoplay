import { h, clear, icon, toast, spinner, emptyState, errorState, mediaCard, watchHref, fmtTime } from "/js/ui.js";
import { api } from "/js/api.js";

export async function render(root, ctx) {
  const mediaId = ctx.args[0];
  if (!mediaId) { location.hash = "#/discover"; return; }
  let d;
  try { d = await api.post("/media/details", { mediaId, alternatives: true }); }
  catch (e) {
    root.append(h("a", { href: "#/discover", class: "btn btn-sm btn-ghost" }, "← Back"), errorState(e.code === "extension_disabled" || e.code === "extension_not_found" ? e.message + ". Enable or install the extension to open this item." : e.message, () => location.reload()));
    return;
  }
  const m = d.media; root.dataset.title = m.title;
  const [epsR, histR, favR] = await Promise.allSettled([d.provider.capabilities.includes("episodes") ? api.post("/media/episodes", { mediaId }) : Promise.resolve({ supported: false, episodes: [] }), api.get("/history?limit=100"), api.get("/favorites")]);
  const eps = epsR.status === "fulfilled" ? epsR.value.episodes : [];
  const hist = histR.status === "fulfilled" ? histR.value.items.filter((i) => i.mediaId === mediaId) : [];
  let isFav = favR.status === "fulfilled" && favR.value.items.some((i) => i.mediaId === mediaId);

  const poster = h("div", { class: "mposter" }, h("div", { class: "ph" }, m.title));
  if (m.poster) { const img = h("img", { src: m.poster, alt: `Poster for ${m.title}`, referrerpolicy: "no-referrer" }); img.onerror = () => img.remove(); poster.append(img); }
  const favBtn = h("button", { class: "btn", onclick: async () => {
    try {
      if (isFav) await api.del("/favorites?mediaId=" + encodeURIComponent(mediaId));
      else await api.post("/favorites", { mediaId, title: m.title, poster: m.poster || undefined, type: m.type, genres: m.genres });
      isFav = !isFav; paintFav();
    } catch (e) { toast(e.message, "bad"); }
  } });
  const paintFav = () => { clear(favBtn).append(icon("heart", 18), isFav ? "In favorites" : "Add to favorites"); favBtn.firstChild.setAttribute("fill", isFav ? "currentColor" : "none"); };
  paintFav();

  const last = hist.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
  const canWatch = d.provider.capabilities.includes("streams");
  let playTarget = null, playLabel = "Play";
  if (eps.length) { const ep = (last && eps.find((e) => e.id === last.episodeId)) || eps[0]; playTarget = watchHref(mediaId, ep.id); playLabel = last ? `Continue ${ep.title}` : `Play ${ep.title}`; }
  else if (!epsR.value?.supported && canWatch || (epsR.status === "fulfilled" && !eps.length && m.type !== "series" && canWatch)) { playTarget = watchHref(mediaId); playLabel = last ? "Continue" : "Play"; }

  const info = h("div", { class: "stack-sm" },
    h("div", { class: "row" }, h("span", { class: "badge badge-accent" }, m.type), m.demo && h("span", { class: "badge badge-demo" }, "Demo"), m.year && h("span", { class: "chip" }, m.year), m.status && h("span", { class: "chip" }, m.status), (m.episodeCount || eps.length) ? h("span", { class: "chip" }, `${m.episodeCount || eps.length} episodes`) : null),
    h("h1", null, m.title),
    m.alternativeTitles.length ? h("div", { class: "muted small" }, "Also known as: " + m.alternativeTitles.join(" · ")) : null,
    m.genres.length ? h("div", { class: "row" }, m.genres.map((g) => h("span", { class: "chip" }, g))) : null,
    h("p", { class: m.description ? "" : "muted" }, m.description || "No synopsis provided by this source."),
    h("div", { class: "row" }, playTarget ? h("a", { class: "btn btn-primary", href: playTarget }, icon("play", 18), playLabel) : h("button", { class: "btn", disabled: true }, canWatch ? (m.type === "series" ? "No episodes reported" : "No source") : "Provider has no streams"), favBtn),
    h("div", { class: "small muted" }, "Provided by ", h("strong", null, d.provider.name), d.provider.demo ? " (Demo)" : "", d.alternatives.length ? [" · Also on: ", d.alternatives.map((a, i) => [i ? ", " : "", h("a", { href: "#/media/" + encodeURIComponent(a.mediaId), style: "text-decoration:underline" }, a.name)])] : null));

  root.append(h("div", { class: "stack" }, h("a", { href: "javascript:history.back()", class: "btn btn-sm btn-ghost", style: "justify-self:start" }, "← Back"), h("div", { class: "detail" }, poster, info), eps.length ? episodeList(eps, mediaId, hist) : (epsR.status === "rejected" ? h("div", { class: "notice" }, "Episodes could not be loaded: " + epsR.reason.message) : null)));
}

function episodeList(eps, mediaId, hist) {
  const seasons = [...new Set(eps.map((e) => e.season))];
  let season = seasons[0];
  const list = h("div", { class: "eps" });
  const draw = () => {
    clear(list).append(eps.filter((e) => e.season === season).map((e) => {
      const hh = hist.find((x) => x.episodeId === e.id);
      return h("a", { class: "ep", href: watchHref(mediaId, e.id) }, h("div", { class: "num" }, e.number ?? "•"), h("div", null, h("div", { style: "font-weight:600" }, e.title), hh ? h("div", { class: "small muted" }, hh.duration && hh.position > hh.duration - 15 ? "Watched" : `Resume at ${fmtTime(hh.position)}`) : null), icon("play", 18));
    }));
  };
  draw();
  return h("section", null, h("div", { class: "sec-head" }, h("h2", null, "Episodes"), seasons.length > 1 ? h("select", { class: "select", "aria-label": "Season", onchange: (e) => { season = Number(e.target.value); draw(); } }, seasons.map((s) => h("option", { value: s }, "Season " + s))) : null), list);
}