import { h, clear, icon, toast, modal, confirmBox, spinner, emptyState, errorState } from "/js/ui.js";
import { api } from "/js/api.js";

const PERM = {
  network: (e) => `Connects to the internet, only to: ${e.allowedDomains && e.allowedDomains.length ? e.allowedDomains.join(", ") : "its own add-on server"}`,
  "external-media": () => "Can offer streams hosted on any public domain (still blocked from private networks)",
  subtitles: () => "Can supply subtitle files",
  browser: () => "May render pages with a managed headless browser when plain extraction finds nothing",
};
const TABS = [["installed", "Installed"], ["available", "Available"], ["updates", "Updates"], ["disabled", "Disabled"], ["failed", "Failed"]];
const FORMAT_LABEL = { "muvoplay-json": "Muvoplay JSON", stremio: "Stremio add-on", cloudstream: "CloudStream (.cs3)", vega: "Vega Provider" };

export async function render(root, ctx) {
  root.dataset.title = "Extensions";
  let tab = TABS.some((t) => t[0] === ctx.query.tab) ? ctx.query.tab : "installed", q = "", fmt = "", data;
  const body = h("div"), tabsEl = h("div", { class: "tabs", role: "tablist" });
  const search = h("input", { class: "input", type: "search", placeholder: "Search extensions", "aria-label": "Search extensions", style: "max-width:320px", oninput: () => { q = search.value.toLowerCase(); draw(); } });
  const fmtSel = h("select", { class: "select", "aria-label": "Format", onchange: () => { fmt = fmtSel.value; draw(); } }, h("option", { value: "" }, "All formats"), Object.entries(FORMAT_LABEL).map(([v, l]) => h("option", { value: v }, l)));
  root.append(h("div", { class: "stack-sm" }, h("div", { class: "page-head" }, h("h1", null, "Extensions"), h("div", { class: "row" }, h("button", { class: "btn", onclick: () => addFromUrl() }, icon("link", 16), "From manifest URL"), h("button", { class: "btn", onclick: () => addFromJson() }, icon("plus", 16), "Paste manifest"))), h("div", { class: "row" }, search, fmtSel), tabsEl, body));

  async function load() { clear(body).append(spinner()); try { data = await api.get("/extensions"); draw(); } catch (e) { clear(body).append(errorState(e.message, load)); } }

  const match = (x) => (!q || (x.name + " " + x.description + " " + x.key).toLowerCase().includes(q)) && (!fmt || x.format === fmt);
  function lists() {
    const inst = data.installed;
    const availOk = data.available.filter((a) => a.status === "ok" && !a.installed);
    return {
      installed: inst.filter((e) => e.status === "installed" && e.enabled), disabled: inst.filter((e) => e.status === "installed" && !e.enabled),
      failed: [...inst.filter((e) => e.status !== "installed"), ...data.available.filter((a) => a.status !== "ok").map((a) => ({ ...a, entry: true }))],
      updates: data.updates, available: [...data.builtin.filter((b) => !b.installed).map((b) => ({ ...b, builtin: true })), ...availOk],
    };
  }
  function draw() {
    const L = lists();
    clear(tabsEl).append(TABS.map(([k, l]) => h("button", { class: "tab" + (k === tab ? " active" : ""), role: "tab", "aria-selected": k === tab, onclick: () => { tab = k; draw(); } }, l, h("span", { class: "badge count" }, L[k].length))));
    const items = L[tab].filter(match);
    clear(body);
    if (!items.length) {
      const hint = { installed: "Enable an installed extension to use it.", available: "Add a repository or install a manifest to see more extensions.", updates: "Everything is up to date.", disabled: "No disabled extensions.", failed: "No failures." }[tab];
      body.append(emptyState(q || fmt ? "No matching extensions" : "Nothing here", q || fmt ? "Try clearing the search or filter." : hint, tab === "available" ? h("a", { class: "btn btn-primary", href: "#/repositories" }, "Add repository") : null));
      return;
    }
    body.append(h("div", { class: "ext-list" }, items.map((x) => card(x))));
  }
  async function act(fn, ok) { try { await fn(); if (ok) toast(ok, "ok"); await load(); } catch (e) { toast(e.message, "bad"); await load(); } }

  async function install(x) {
    const perms = x.permissions || [];
    const go = await modal({ title: `Install ${x.name}?`, body: h("div", null, h("p", { class: "muted small" }, `${FORMAT_LABEL[x.format] || x.format} · v${x.version}${x.author ? " · " + x.author : ""}`), x.demo ? h("div", { class: "notice", style: "margin:10px 0" }, "Demo extension: sample items and public test streams, not a real source.") : null,
      h("h3", { style: "margin-top:12px" }, "Permissions requested"), perms.map((p) => h("div", { class: "perm" }, h("strong", null, p), h("span", { class: "small muted" }, (PERM[p] || (() => ""))(x)))), h("p", { class: "small muted", style: "margin-top:10px" }, "Installing does not run anything. You choose when to enable it.")),
      actions: [{ label: "Cancel", value: null }, { label: "Install", value: "install", class: "btn-primary" }, { label: "Install and enable", value: "enable", class: "btn-primary" }] });
    if (!go) return;
    await act(async () => {
      const r = await api.post("/extensions/install", x.builtin ? { builtin: x.key } : { repositoryId: x.repositoryId, extensionKey: x.key });
      if (go === "enable") await api.post(`/extensions/${r.id}/enable`);
    }, "Installed");
  }
  async function addFromUrl() {
    const input = h("input", { class: "input", placeholder: "https://…/manifest.json or *.muvoplay.json", maxlength: 2048, "aria-label": "Manifest URL" });
    const ok = await modal({ title: "Install from manifest URL", body: h("div", { class: "stack-sm" }, h("p", { class: "muted small" }, "Supports Muvoplay JSON manifests and Stremio add-on manifests. CloudStream .cs3 files are not supported."), input), actions: [{ label: "Cancel", value: false }, { label: "Install", value: true, class: "btn-primary" }] });
    if (ok && input.value.trim()) await act(() => api.post("/extensions/install", { manifestUrl: input.value.trim() }), "Installed. Review permissions, then enable it.");
  }
  async function addFromJson() {
    const ta = h("textarea", { class: "textarea", placeholder: '{ "schemaVersion": 1, "id": "my.source", ... }', "aria-label": "Manifest JSON", spellcheck: "false" });
    const ok = await modal({ title: "Paste a .muvoplay.json manifest", body: ta, actions: [{ label: "Cancel", value: false }, { label: "Validate & install", value: true, class: "btn-primary" }] });
    if (!ok) return;
    let m; try { m = JSON.parse(ta.value); } catch { return toast("That is not valid JSON", "bad"); }
    await act(() => api.post("/extensions/install", { manifest: m }), "Installed. Review permissions, then enable it.");
  }

  function card(x) {
    const inst = typeof x.enabled === "boolean";
    const meta = h("div", { class: "meta" }, h("span", { class: "badge badge-accent" }, FORMAT_LABEL[x.format] || x.format), x.version ? h("span", { class: "badge" }, "v" + (x.installedVersion && x.version ? x.installedVersion + " → " + x.version : x.version)) : null,
      x.demo ? h("span", { class: "badge badge-demo" }, "Demo") : null,
      inst ? h("span", { class: "badge " + (x.status !== "installed" ? "badge-bad" : x.enabled ? "badge-ok" : "") }, x.status === "unsupported" ? "Unsupported" : x.status === "failed" ? "Failed" : x.enabled ? "Enabled" : "Disabled") : null,
      x.entry ? h("span", { class: "badge badge-bad" }, x.status === "unsupported" ? "Unsupported" : "Invalid") : null);
    const origin = x.repositoryName || (x.builtin ? "Built in" : x.baseUrl ? "Manual install" : "");
    const caps = (x.capabilities || []).length ? h("div", { class: "small muted" }, "Capabilities: " + x.capabilities.join(", ")) : null;
    const perms = (x.permissions || []).length ? h("div", { class: "small muted" }, "Permissions: " + x.permissions.join(", ")) : null;
    const acts = h("div", { class: "actions" });
    if (x.entry) { /* no actions: reason shown below */ }
    else if (inst) {
      if (x.status === "installed") acts.append(x.enabled ? h("button", { class: "btn btn-sm", onclick: () => act(() => api.post(`/extensions/${x.id}/disable`), "Disabled") }, "Disable") : h("button", { class: "btn btn-sm btn-primary", onclick: () => act(() => api.post(`/extensions/${x.id}/enable`), "Enabled") }, "Enable"));
      else acts.append(h("button", { class: "btn btn-sm", onclick: () => act(() => api.post(`/extensions/${x.id}/enable`), "Enabled") }, "Re-validate"));
      if (data.updates.some((u) => u.extensionId === x.id)) acts.append(h("button", { class: "btn btn-sm btn-primary", onclick: () => act(() => api.post(`/extensions/${x.id}/update`), "Updated") }, icon("refresh", 14), "Update"));
      acts.append(h("button", { class: "btn btn-sm btn-danger", onclick: async () => { if (await confirmBox("Uninstall extension?", `${x.name} will be removed. Your history and favorites are kept.`, "Uninstall", true)) act(() => api.del(`/extensions/${x.id}`), "Uninstalled"); } }, icon("trash", 14), "Uninstall"));
    } else if (x.extensionId) {
      acts.append(h("button", { class: "btn btn-sm btn-primary", onclick: () => act(() => api.post(`/extensions/${x.extensionId}/update`), "Updated") }, icon("refresh", 14), "Update to v" + x.version));
    } else acts.append(h("button", { class: "btn btn-sm btn-primary", onclick: () => install(x) }, icon("plus", 14), "Install"));
    return h("div", { class: "ecard" }, h("h3", null, x.name), meta, h("p", { class: "small muted" }, x.description || "No description."), x.author ? h("div", { class: "small muted" }, "By " + x.author) : null, origin ? h("div", { class: "small muted" }, "Source: " + origin) : null, caps, perms,
      x.lastError ? h("div", { class: "err-text" }, x.lastError) : null, x.reason ? h("div", { class: "err-text" }, x.reason) : null, acts);
  }
  await load();
}