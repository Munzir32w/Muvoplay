import { h, clear, icon, spinner, skeletons, emptyState, errorState, mediaCard } from "/js/ui.js";
import { api } from "/js/api.js";

const PAGE = 24;

export async function render(root, ctx) {
  root.dataset.title = "Discover";
  let q = (ctx.query.q || "").trim(), type = ctx.query.type || "", provider = ctx.query.provider || "", genre = "", year = "";
  let all = [], shown = PAGE, catPage = 1, hasMore = false, errors = [], loading = false;

  const exts = (await api.get("/extensions")).installed.filter((e) => e.enabled && e.status === "installed");
  const results = h("div"), notes = h("div", { class: "stack-sm" }), moreBox = h("div", { class: "center", style: "margin-top:18px" });
  const qIn = h("input", { class: "input", type: "search", placeholder: q ? "" : "Search by title", value: q, maxlength: 200, "aria-label": "Search by title" });
  const typeSel = h("select", { class: "select", "aria-label": "Media type", onchange: () => { type = typeSel.value; draw(); } }, [["", "All types"], ["movie", "Movies"], ["series", "Series"], ["anime", "Anime"], ["other", "Other"]].map(([v, l]) => h("option", { value: v, selected: v === type }, l)));
  const provSel = h("select", { class: "select", "aria-label": "Provider", onchange: () => { provider = provSel.value; run(true); } }, h("option", { value: "" }, "All providers"), exts.map((e) => h("option", { value: e.key, selected: e.key === provider }, e.name + (e.demo ? " (Demo)" : ""))));
  const genreSel = h("select", { class: "select", "aria-label": "Genre", onchange: () => { genre = genreSel.value; draw(); } });
  const yearIn = h("input", { class: "input", type: "number", min: 1880, max: 2100, placeholder: "Year", style: "width:100px", "aria-label": "Year", oninput: () => { year = yearIn.value; draw(); } });
  const form = h("form", { class: "searchbar", onsubmit: (e) => { e.preventDefault(); q = qIn.value.trim(); history.replaceState(null, "", "#/discover" + (q ? "?q=" + encodeURIComponent(q) : "")); run(true); } }, qIn, h("button", { class: "btn btn-primary" }, icon("search", 18), "Search"));
  root.append(h("div", { class: "stack-sm" }, h("h1", null, "Discover"), form, h("div", { class: "row" }, typeSel, provSel, genreSel, yearIn), notes, results, moreBox));

  function fillGenres() {
    const gs = [...new Set(all.flatMap((i) => i.genres))].sort();
    clear(genreSel).append(h("option", { value: "" }, "All genres"), gs.map((g) => h("option", { value: g, selected: g === genre }, g)));
    if (!gs.includes(genre)) genre = "";
  }
  function draw() {
    const list = all.filter((i) => (!type || i.type === type) && (!genre || i.genres.includes(genre)) && (!year || i.year === Number(year)));
    clear(results);
    clear(moreBox);
    if (!exts.length) { results.append(emptyState("No active extensions", "Enable an extension to search and browse.", h("a", { class: "btn btn-primary", href: "#/extensions" }, "Open extensions"))); return; }
    if (!list.length) { results.append(emptyState(q ? `No results for "${q}"` : "Nothing to show", all.length ? "Try clearing a filter." : "Try a different title or provider.")); }
    else results.append(h("div", { class: "grid" }, list.slice(0, shown).map((i) => mediaCard(i))));
    if (list.length > shown) moreBox.append(h("button", { class: "btn", onclick: () => { shown += PAGE; draw(); } }, `Show more (${list.length - shown} left)`));
    else if (!q && hasMore) moreBox.append(h("button", { class: "btn", onclick: loadMore }, "Load more from providers"));
  }
  async function loadMore() { catPage++; await run(false); }
  async function run(reset) {
    if (loading) return; loading = true;
    if (reset) { all = []; shown = PAGE; catPage = 1; clear(results).append(skeletons(12)); clear(moreBox); }
    clear(notes);
    try {
      const providers = provider ? [provider] : undefined;
      if (q) {
        const r = await api.post("/search", { query: q, providers });
        all = r.results; errors = r.errors; hasMore = false;
        if (r.searched) notes.append(h("div", { class: "muted small" }, `${r.total} result${r.total === 1 ? "" : "s"} from ${r.providers.map((p) => p.name + " (" + p.count + ")").join(", ") || "no providers"}`));
      } else {
        const r = await api.post("/catalog", { page: catPage, limit: 48, providers });
        const seen = new Set(all.map((i) => i.id)); const fresh = r.sections.flatMap((s) => s.items).filter((i) => !seen.has(i.id));
        all = all.concat(fresh); errors = r.errors; hasMore = fresh.length > 0 && catPage < 50;
      }
      for (const e of errors) notes.append(h("div", { class: "notice" }, `${e.name}: ${e.message}`));
      fillGenres(); draw();
    } catch (e) { clear(results).append(errorState(e.message, () => run(true))); }
    loading = false;
  }
  if (exts.length) await run(true); else draw();
}