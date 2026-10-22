const KEY = "muvoplay.settings.v1";
export const DEFAULTS = { theme: "dark", speed: 1, volume: 1, resume: true, autoplayNext: true, autoplay: false, subtitlesOn: false, subtitleLang: "en", subtitleSize: "medium" };

let cache = null;
export function settings() {
  if (cache) return cache;
  try { cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { cache = { ...DEFAULTS }; }
  return cache;
}
export function setSetting(k, v) {
  cache = { ...settings(), [k]: v };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {}
  applySettings();
}
export function applySettings() {
  const s = settings();
  const dark = s.theme === "system" ? !(window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches) : s.theme !== "light";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0B0B12" : "#F6F6FA";
  document.documentElement.style.setProperty("--cue-size", { small: "0.9em", medium: "1.1em", large: "1.5em" }[s.subtitleSize] || "1.1em");
}