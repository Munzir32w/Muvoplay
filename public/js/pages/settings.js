import { h, clear, icon, toast, confirmBox } from "/js/ui.js";
import { api } from "/js/api.js";
import { settings, setSetting } from "/js/store.js";

export async function render(root) {
  root.dataset.title = "Settings";
  const s = () => settings();
  const sel = (key, opts, num) => h("select", { class: "select", "aria-label": key, onchange: (e) => setSetting(key, num ? Number(e.target.value) : e.target.value) }, opts.map(([v, l]) => h("option", { value: v, selected: String(s()[key]) === String(v) }, l)));
  const tog = (key, label, hint) => { const cb = h("input", { type: "checkbox", checked: !!s()[key], style: "width:22px;height:22px;accent-color:var(--accent)", "aria-label": label, onchange: () => setSetting(key, cb.checked) }); return h("label", { class: "switch-row" }, h("span", null, h("div", null, label), hint ? h("div", { class: "small muted" }, hint) : null), cb); };
  const row = (label, ctrl, hint) => h("div", { class: "switch-row" }, h("span", null, h("div", null, label), hint ? h("div", { class: "small muted" }, hint) : null), ctrl);
  const histBox = h("div", { class: "small muted" }, "Loading…"), health = h("div", { class: "small muted" }, "Checking…");

  const refreshHist = async () => { try { const r = await api.get("/history?limit=1"); clear(histBox).append(`${r.total} item${r.total === 1 ? "" : "s"} in your watch history`); } catch (e) { clear(histBox).append(e.message); } };
  root.append(h("div", { class: "stack", style: "max-width:720px" }, h("h1", null, "Settings"),
    h("section", { class: "panel" }, h("h2", null, "Appearance"), row("Theme", sel("theme", [["dark", "Dark"], ["light", "Light"], ["system", "System"]]))),
    h("section", { class: "panel" }, h("h2", null, "Player"), tog("autoplay", "Autoplay", "Start playback as soon as a source is ready (browsers may block this)."), tog("autoplayNext", "Autoplay next episode"), tog("resume", "Resume where you left off"),
      row("Default speed", sel("speed", [[0.5, "0.5x"], [0.75, "0.75x"], [1, "1x"], [1.25, "1.25x"], [1.5, "1.5x"], [2, "2x"]], true))),
    h("section", { class: "panel" }, h("h2", null, "Subtitles"), tog("subtitlesOn", "Show subtitles automatically", "Only when a track in your preferred language exists."),
      row("Preferred language", sel("subtitleLang", [["en", "English"], ["id", "Indonesian"], ["ja", "Japanese"], ["es", "Spanish"], ["fr", "French"], ["de", "German"], ["pt", "Portuguese"]])),
      row("Size", sel("subtitleSize", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]]))),
    h("section", { class: "panel" }, h("h2", null, "Repositories"), h("p", { class: "muted small" }, "Add, refresh or remove extension repositories."), h("div", { style: "margin-top:10px" }, h("a", { class: "btn", href: "#/repositories" }, icon("repo", 16), "Manage repositories"))),
    h("section", { class: "panel" }, h("h2", null, "History"), histBox, h("div", { style: "margin-top:10px" }, h("button", { class: "btn btn-danger", onclick: async () => { if (await confirmBox("Clear watch history?", "All saved positions and Continue watching entries will be deleted. Favorites are kept.", "Clear history", true)) { try { const r = await api.del("/history"); toast(`Deleted ${r.deleted} item(s)`, "ok"); } catch (e) { toast(e.message, "bad"); } refreshHist(); } } }, icon("trash", 16), "Clear watch history"))),
    h("section", { class: "panel" }, h("h2", null, "About Muvoplay"), h("p", { class: "muted small" }, "A media platform that runs on extensions you choose. Muvoplay ships no content and does not bypass DRM or access controls."), h("div", { class: "small", style: "margin-top:8px" }, "Version 0.1.0"), health, h("div", { style: "margin-top:10px" }, h("a", { class: "btn", href: "#/docs" }, icon("book", 16), "Documentation")))));
  refreshHist();
  try { const r = await api.get("/health"); clear(health).append(`Server: ${r.status} · database: ${r.database}`); } catch (e) { clear(health).append("Server: unreachable"); }
}