import { h, clear, icon, toast, errorState, spinner } from "/js/ui.js";
import { applySettings } from "/js/store.js";

applySettings();

const NAV = [
  ["home", "Home", "#/"], ["search", "Discover", "#/discover"], ["puzzle", "Extensions", "#/extensions"], ["repo", "Repositories", "#/repositories"], ["settings", "Settings", "#/settings"],
];
const PAGES = {
  home: () => import("/js/pages/home.js"), discover: () => import("/js/pages/discover.js"), media: () => import("/js/pages/media.js"), watch: () => import("/js/pages/watch.js"),
  extensions: () => import("/js/pages/extensions.js"), repositories: () => import("/js/pages/repositories.js"), settings: () => import("/js/pages/settings.js"), docs: () => import("/js/pages/docs.js"),
};

let user = null, main, cleanup = null, token = 0;

function parse() {
  const raw = location.hash.slice(1) || "/";
  const [path, qs] = raw.split("?");
  const segs = path.split("/").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  return { name: segs[0] || "home", args: segs.slice(1), query: Object.fromEntries(new URLSearchParams(qs || "")) };
}

function navLinks(cls, withText) {
  const cur = location.hash.split("?")[0] || "#/";
  return NAV.map(([ic, label, href]) => h("a", { href, class: cur === href || (href !== "#/" && cur.startsWith(href)) ? "active" : "", "aria-label": label }, icon(ic, cls), withText ? label : h("span", null, label === "Repositories" ? "Repos" : label)));
}

function shell() {
  const app = document.getElementById("app");
  clear(app);
  main = h("main", { class: "main", id: "main" });
  const signOut = async () => { await window.hatchable.auth.signOut(); location.href = "/login"; };
  app.append(h("div", { class: "topbar" }, h("a", { class: "logo", href: "#/" }, "Muvo", h("b", null, "play")), h("a", { href: "#/discover", class: "btn btn-icon btn-ghost", "aria-label": "Search" }, icon("search"))),
    h("div", { class: "shell" },
      h("aside", { class: "sidebar" }, h("a", { class: "logo", href: "#/" }, "Muvo", h("b", null, "play")), h("nav", { class: "nav", id: "sidenav" }),
        h("div", { class: "side-foot" }, h("a", { href: "#/docs", class: "muted small" }, "Docs & extension format"), h("div", { class: "small muted", style: "overflow-wrap:anywhere" }, user && user.email), h("button", { class: "btn btn-sm btn-ghost", onclick: signOut }, icon("logout", 16), "Sign out"))),
      main),
    h("nav", { class: "bottomnav", id: "botnav", "aria-label": "Primary" }));
  updateNav();
}
function updateNav() {
  const s = document.getElementById("sidenav"), b = document.getElementById("botnav");
  if (s) { clear(s).append(...navLinks(20, true)); } if (b) { clear(b).append(...navLinks(22, false)); }
}

async function route() {
  const my = ++token;
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const r = parse();
  updateNav();
  clear(main).append(spinner());
  window.scrollTo(0, 0);
  const loader = PAGES[r.name] || PAGES.home;
  try {
    const mod = await loader();
    if (my !== token) return;
    const root = h("div", null);
    const fn = await mod.render(root, r, () => my === token);
    if (my !== token) { if (fn) fn(); return; }
    clear(main).append(root);
    cleanup = fn || null;
    document.title = (root.dataset.title ? root.dataset.title + " · " : "") + "Muvoplay";
  } catch (e) {
    if (my === token) clear(main).append(errorState(e.message || "Failed to load this page", route));
  }
}

async function start() {
  let session = null;
  try { session = await window.hatchable.auth.getSession(); } catch {}
  if (!session || !session.user) { location.href = "/login?next=" + encodeURIComponent("/" + location.hash); return; }
  user = session.user;
  shell();
  window.addEventListener("hashchange", route);
  window.addEventListener("unhandledrejection", (e) => { if (e.reason && e.reason.status === 401) return; });
  route();
}
start().catch((e) => { document.getElementById("app").textContent = "Failed to start: " + e.message; });