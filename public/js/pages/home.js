import { h, clear, icon, toast, spinner, skeletons, emptyState, errorState, mediaCard, watchHref, ago } from "/js/ui.js";
import { api } from "/js/api.js";

export async function render(root) {
  root.dataset.title = "Home";
  const exts = h("div"), content = h("div", { class: "stack" });
  const form = h("form", { class: "searchbar", onsubmit: (e) => { e.preventDefault(); const q = new FormData(form).get("q").trim(); location.hash = "#/discover" + (q ? "?q=" + encodeURIComponent(q) : ""); } },
    h("input", { class: "input", name: "q", type: "search", placeholder: "Search titles across your extensions", "aria-label": "Search", maxlength: 200 }), h("button", { class: "btn btn-primary" }, icon("search", 18), "Search"));
  root.append(h("div", { class: "stack" }, h("div", { class: "stack-sm" }, h("h1", null, "Home"), form), exts, content));

  const load = async () => {
    clear(exts).append(spinner());
    const [ex, repos] = await Promise.all([api.get("/extensions"), api.get("/repositories")]);
    const enabled = ex.installed.filter((e) => e.enabled && e.status === "installed");
    clear(exts);
    exts.append(h("div", { class: "status-strip" },
      stat(repos.length, "Repositories", "#/repositories"), stat(ex.installed.length, "Installed extensions", "#/extensions"), stat(enabled.length, "Active extensions", "#/extensions"),
      stat(ex.updates.length, "Updates available", "#/extensions?tab=updates")));
    if (ex.installed.some((e) => e.status === "failed")) exts.append(h("div", { class: "notice bad", style: "margin-top:12px" }, "Some extensions failed validation. ", h("a", { href: "#/extensions?tab=failed", style: "text-decoration:underline" }, "Review")));

    clear(content);
    if (!enabled.length) {
      content.append(emptyState("No active extensions yet", "Extensions provide catalogs, search and streams. Add a repository, install a manifest, or try the built-in demo.",
        h("button", { class: "btn btn-primary", onclick: async (ev) => { ev.target.disabled = true; try { const x = await api.post("/extensions/install", { builtin: "muvoplay.demo" }); await api.post(`/extensions/${x.id}/enable`); toast("Demo extension enabled", "ok"); load(); } catch (e) { toast(e.message, "bad"); ev.target.disabled = false; } } }, "Install demo extension"),
        h("a", { class: "btn", href: "#/repositories" }, "Add repository"), h("a", { class: "btn", href: "#/extensions" }, "Browse extensions")));
    }
    const hist = h("div"), favs = h("div"), rec = h("div"), cat = h("div", { class: "stack" });
    content.append(hist, favs, rec, cat);
    const [hr, fr] = await Promise.allSettled([api.get("/history?limit=20"), api.get("/favorites")]);
    if (hr.status === "fulfilled" && hr.value.items.length) {
      hist.append(section("Continue watching", rail(hr.value.items.map((i) => mediaCard({ id: i.mediaId, title: i.title, poster: i.poster, type: i.type, genres: i.genres }, { href: watchHref(i.mediaId, i.episodeId), progress: i.duration ? i.position / i.duration : 0, sub: (i.episodeTitle ? i.episodeTitle + " · " : "") + ago(i.updatedAt) })))));
    }
    if (fr.status === "fulfilled" && fr.value.items.length) favs.append(section("Favorites", rail(fr.value.items.map((i) => mediaCard({ id: i.mediaId, title: i.title, poster: i.poster, type: i.type, genres: i.genres })))));
    if (!enabled.some((e) => e.capabilities.includes("catalog"))) return;
    cat.append(h("div", { class: "muted small" }, "Loading catalogs…"));
    try {
      const c = await api.post("/catalog", { page: 1, limit: 18 });
      clear(cat);
      for (const e of c.errors) cat.append(h("div", { class: "notice" }, `${e.name}: ${e.message}`));
      for (const s of c.sections) {
        if (!s.items.length) continue;
        cat.append(section(s.name, rail(s.items.map((i) => mediaCard(i))), s.demo ? h("span", { class: "badge badge-demo" }, "Demo") : null));
      }
      if (!c.sections.some((s) => s.items.length) && !c.errors.length) cat.append(emptyState("Catalogs are empty", "The active extensions returned no items."));
      // Recommendations: catalog items whose genres overlap with favorites and history
      const seen = new Set([...(hr.value?.items || []).map((i) => i.mediaId), ...(fr.value?.items || []).map((i) => i.mediaId)]);
      const weight = {};
      for (const i of [...(hr.value?.items || []), ...(fr.value?.items || [])]) for (const g of i.genres || []) if (g !== "Demo") weight[g] = (weight[g] || 0) + 1;
      const scored = c.sections.flatMap((s) => s.items).filter((i) => !seen.has(i.id)).map((i) => ({ i, s: (i.genres || []).reduce((a, g) => a + (weight[g] || 0), 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12);
      if (scored.length) rec.append(section("Recommended for you", rail(scored.map((x) => mediaCard(x.i))), h("span", { class: "muted small" }, "Based on genres you watched or saved")));
    } catch (e) { clear(cat).append(errorState(e.message, load)); }
  };
  try { await load(); } catch (e) { clear(exts).append(errorState(e.message, load)); }
}

const stat = (n, label, href) => h("a", { class: "stat", href }, h("b", null, n), h("span", { class: "muted small" }, label));
const rail = (cards) => h("div", { class: "rail" }, cards);
const section = (title, body, extra) => h("section", null, h("div", { class: "sec-head" }, h("div", { class: "row" }, h("h2", null, title), extra)), body);