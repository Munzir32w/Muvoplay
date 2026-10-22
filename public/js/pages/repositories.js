import { h, clear, icon, toast, spinner, confirmBox, emptyState, errorState, ago } from "/js/ui.js";
import { api } from "/js/api.js";

const SAMPLE = `{
  "name": "My repository",
  "extensions": [
    { "id": "my.source", "name": "My Source", "version": "1.0.0",
      "format": "muvoplay-json", "manifestUrl": "https://example.com/my.source.muvoplay.json" },
    { "id": "some.addon", "name": "Stremio add-on", "version": "1.0.0",
      "format": "stremio", "manifestUrl": "https://addon.example.com/manifest.json" }
  ]
}`;

export async function render(root) {
  root.dataset.title = "Repositories";
  const list = h("div", { class: "stack-sm" });
  const url = h("input", { class: "input", type: "url", placeholder: "https://example.com/repository.json", maxlength: 2048, required: true, "aria-label": "Repository URL" });
  const name = h("input", { class: "input", placeholder: "Name (optional)", maxlength: 80, "aria-label": "Repository name" });
  const addBtn = h("button", { class: "btn btn-primary" }, icon("plus", 16), "Add repository");
  const form = h("form", { class: "panel stack-sm", onsubmit: async (e) => {
    e.preventDefault(); addBtn.disabled = true;
    try { const r = await api.post("/repositories", { url: url.value.trim(), name: name.value.trim() || undefined }); toast(`Added "${r.name}" with ${r.extensionCount} valid extension${r.extensionCount === 1 ? "" : "s"}`, "ok"); form.reset(); await load(); }
    catch (err) { toast(err.message, "bad"); }
    addBtn.disabled = false;
  } }, h("h2", null, "Add a repository"), h("div", { class: "field" }, h("label", null, "Index URL (http/https, public hosts only)"), url), h("div", { class: "field" }, h("label", null, "Name"), name), h("div", null, addBtn),
    h("details", { class: "box" }, h("summary", null, "Repository index format"), h("pre", { class: "doc", style: "overflow-x:auto" }, SAMPLE)));
  root.append(h("div", { class: "stack" }, h("h1", null, "Repositories"), form, list));

  async function load() {
    clear(list).append(spinner());
    try {
      const repos = await api.get("/repositories");
      clear(list);
      if (!repos.length) return list.append(emptyState("No repositories", "A repository is a JSON index that lists extensions. Adding one does not install or run anything."));
      for (const r of repos) list.append(h("div", { class: "ecard" }, h("div", { class: "row" }, h("h3", null, r.name), r.lastError ? h("span", { class: "badge badge-bad" }, "Unavailable") : h("span", { class: "badge badge-ok" }, "OK")),
        h("div", { class: "small muted", style: "overflow-wrap:anywhere" }, r.url), h("div", { class: "small muted" }, `${r.extensionCount} valid extension${r.extensionCount === 1 ? "" : "s"} · refreshed ${ago(r.lastRefreshedAt)}`),
        r.lastError ? h("div", { class: "err-text" }, r.lastError) : null,
        h("div", { class: "actions" }, h("a", { class: "btn btn-sm", href: "#/extensions?tab=available" }, "View extensions"),
          h("button", { class: "btn btn-sm", onclick: async (ev) => { ev.currentTarget.disabled = true; try { await api.post(`/repositories/${r.id}/refresh`); toast("Repository refreshed", "ok"); } catch (e) { toast(e.message, "bad"); } load(); } }, icon("refresh", 14), "Refresh"),
          h("button", { class: "btn btn-sm btn-danger", onclick: async () => { if (await confirmBox("Remove repository?", "Extensions already installed from it stay installed, but they will no longer receive updates from it.", "Remove", true)) { try { await api.del(`/repositories/${r.id}`); toast("Removed", "ok"); } catch (e) { toast(e.message, "bad"); } load(); } } }, icon("trash", 14), "Remove"))));
    } catch (e) { clear(list).append(errorState(e.message, load)); }
  }
  await load();
}