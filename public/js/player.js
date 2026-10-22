import { h, clear, icon, fmtTime } from "/js/ui.js";
import { api } from "/js/api.js";
import { settings } from "/js/store.js";

const HLS_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
const DASH_URL = "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js";
const scripts = {};
const loadScript = (src) => (scripts[src] ||= new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error("script")); }; document.head.append(s); }));

const MESSAGES = {
  network: "Network error while loading this source. The server may be offline, may block this app (CORS), or the link may have expired.",
  expired: "This link has expired or no longer exists.",
  auth: "This source requires authentication or denies access. Muvoplay does not bypass access controls.",
  unsupported: "Your browser cannot play this format.",
  media: "The video could not be decoded.",
  engine: "The player component could not be loaded. Check your connection or content blocker.",
};

/**
 * Player controller. opts: { providerId, onProgress({position,duration}), onEnded, onPrev, onNext, onReloadSources }
 */
export function createPlayer(opts) {
  const s = settings();
  const video = h("video", { playsinline: true, preload: "metadata", "aria-label": "Video" });
  const overlay = h("div", { class: "p-overlay show" }, h("div", { class: "spinner" }));
  const seek = h("input", { class: "p-seek", type: "range", min: 0, max: 1000, value: 0, step: 1, "aria-label": "Seek" });
  const time = h("span", { class: "p-time" }, "0:00 / 0:00");
  const btn = (name, label, fn) => h("button", { class: "p-btn", type: "button", "aria-label": label, title: label, onclick: fn }, icon(name, 22));
  const playBtn = btn("play", "Play", () => toggle());
  const muteBtn = btn("vol", "Mute", () => { video.muted = !video.muted; });
  const vol = h("input", { class: "p-vol", type: "range", min: 0, max: 1, step: 0.05, value: s.volume, "aria-label": "Volume", oninput: () => { video.volume = Number(vol.value); video.muted = false; } });
  const prevBtn = btn("prev", "Previous episode", () => opts.onPrev && opts.onPrev()); prevBtn.hidden = !opts.onPrev;
  const nextBtn = btn("next", "Next episode", () => opts.onNext && opts.onNext()); nextBtn.hidden = !opts.onNext;
  const speed = h("select", { class: "p-sel", "aria-label": "Playback speed", onchange: () => { video.playbackRate = Number(speed.value); } }, [0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => h("option", { value: v, selected: v === Number(s.speed) }, v + "x")));
  const subSel = h("select", { class: "p-sel", "aria-label": "Subtitles", onchange: () => pickSubtitle(Number(subSel.value)) }, h("option", { value: -1 }, "Subtitles off"));
  const srcSel = h("select", { class: "p-sel", "aria-label": "Source", onchange: () => load(Number(srcSel.value)) });
  const fsBtn = btn("full", "Fullscreen", () => fullscreen());
  const el = h("div", { class: "player", tabindex: 0 }, video, overlay,
    h("div", { class: "p-controls" }, seek, h("div", { class: "p-row" }, prevBtn, playBtn, nextBtn, muteBtn, vol, time, h("span", { class: "spacer" }), subSel, speed, srcSel, fsBtn)));

  let sources = [], idx = 0, hls = null, dash = null, startAt = 0, netRetries = 0, mediaRetries = 0, dragging = false, saveTimer = null, idleTimer = null, loadToken = 0, subs = [], subBlobs = [], dead = false;

  function spin() { clear(overlay).append(h("div", { class: "spinner" })); overlay.classList.add("show"); }
  function hideOverlay() { overlay.classList.remove("show"); }
  function fail(kind, extra) {
    if (dead) return;
    const expired = sources[idx] && sources[idx].expiresAt && Date.parse(sources[idx].expiresAt) < Date.now();
    clear(overlay).append(h("div", { class: "box" }, h("strong", null, "Playback problem"), h("p", null, MESSAGES[expired ? "expired" : kind] || MESSAGES.network), extra ? h("p", { class: "small" }, extra) : null,
      h("div", { class: "row", style: "justify-content:center" }, h("button", { class: "btn btn-sm btn-primary", onclick: () => load(idx, true) }, "Retry"),
        sources.length > 1 ? h("button", { class: "btn btn-sm", onclick: () => load((idx + 1) % sources.length) }, "Try next source") : null,
        opts.onReloadSources ? h("button", { class: "btn btn-sm", onclick: () => opts.onReloadSources() }, "Reload sources") : null)));
    overlay.classList.add("show");
  }
  function stopEngines() {
    if (hls) { try { hls.destroy(); } catch {} hls = null; }
    if (dash) { try { dash.reset(); } catch {} dash = null; }
  }
  function toggle() { if (video.paused) video.play().catch(() => {}); else video.pause(); }
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  }
  function report() { if (opts.onProgress && Number.isFinite(video.currentTime) && video.currentTime > 0) opts.onProgress({ position: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0 }); }

  async function load(i, retry = false) {
    if (!sources.length || dead) return;
    const my = ++loadToken;
    if (!retry && i !== idx) startAt = video.currentTime > 5 ? video.currentTime : startAt;
    idx = i; srcSel.value = String(i); netRetries = 0; mediaRetries = 0;
    const src = sources[i];
    stopEngines(); spin();
    video.removeAttribute("src"); video.load();
    for (const t of [...video.querySelectorAll("track")]) t.remove();
    subBlobs.forEach((u) => URL.revokeObjectURL(u.url)); subBlobs = [];
    buildSubtitleMenu(src);
    if (src.expiresAt && Date.parse(src.expiresAt) < Date.now()) return fail("expired");
    if (src.check && src.check.playable === false) return fail(src.check.status === 403 || src.check.status === 401 ? "auth" : "network", src.check.reason);
    try {
      if (src.type === "hls") {
        let ok = true;
        try { await loadScript(HLS_URL); } catch { ok = false; }
        if (my !== loadToken) return;
        if (ok && window.Hls && window.Hls.isSupported()) {
          hls = new window.Hls({ enableWorker: true, maxBufferLength: 30 });
          hls.on(window.Hls.Events.ERROR, (_, d) => {
            if (!d.fatal || my !== loadToken) return;
            if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
              const code = d.response && d.response.code;
              if (code === 401 || code === 403) return fail("auth");
              if (code === 404 || code === 410) return fail("expired");
              if (netRetries++ < 2) return hls.startLoad();
              return fail("network", d.details);
            }
            if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++ < 2) return hls.recoverMediaError();
            fail("media", d.details);
          });
          hls.loadSource(src.url); hls.attachMedia(video);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = src.url;
        else return fail(ok ? "unsupported" : "engine");
      } else if (src.type === "dash") {
        try { await loadScript(DASH_URL); } catch { return fail("engine"); }
        if (my !== loadToken) return;
        dash = window.dashjs.MediaPlayer().create();
        dash.on("error", () => fail("network"));
        dash.initialize(video, src.url, false);
      } else video.src = src.url;
    } catch { return fail("engine"); }
    video.playbackRate = Number(speed.value);
    if (s.autoplay || retry || i !== 0 || startAt) video.play().catch(() => {});
    else if (s.autoplay) video.play().catch(() => {});
  }

  function buildSubtitleMenu(src) {
    subs = src.subtitles || [];
    clear(subSel).append(h("option", { value: -1 }, "Subtitles off"), subs.map((x, k) => h("option", { value: k }, x.label)));
    subSel.hidden = !subs.length;
    const pref = subs.findIndex((x) => x.language && x.language.toLowerCase().startsWith(String(s.subtitleLang).toLowerCase()));
    if (s.subtitlesOn && pref >= 0) { subSel.value = String(pref); pickSubtitle(pref); }
  }
  async function pickSubtitle(k) {
    for (const t of video.textTracks) t.mode = "disabled";
    if (k < 0) return;
    const sub = subs[k];
    let entry = subBlobs.find((b) => b.src === sub.url);
    if (!entry) {
      try {
        const r = await api.post("/media/subtitle", { providerId: opts.providerId, url: sub.url });
        entry = { src: sub.url, url: URL.createObjectURL(new Blob([r.vtt], { type: "text/vtt" })) };
        subBlobs.push(entry);
        video.append(h("track", { kind: "subtitles", label: sub.label, srclang: sub.language && sub.language !== "und" ? sub.language : "en", src: entry.url, "data-src": sub.url }));
      } catch (e) { subSel.value = "-1"; opts.onNotice && opts.onNotice("Subtitle unavailable: " + e.message); return; }
    }
    for (const t of video.textTracks) { const dom = [...video.querySelectorAll("track")].find((d) => d.track === t); t.mode = dom && dom.dataset.src === sub.url ? "showing" : "disabled"; }
  }

  // events
  video.addEventListener("loadedmetadata", () => {
    if (startAt > 0 && Number.isFinite(video.duration) && startAt < video.duration - 15) video.currentTime = startAt;
    startAt = 0;
    time.textContent = "0:00 / " + (Number.isFinite(video.duration) ? fmtTime(video.duration) : "LIVE");
  });
  video.addEventListener("canplay", hideOverlay); video.addEventListener("playing", () => { hideOverlay(); el.classList.add("playing"); });
  video.addEventListener("waiting", () => { if (!video.error) spin(); });
  video.addEventListener("play", () => { clear(playBtn).append(icon("pause", 22)); playBtn.title = "Pause"; clearInterval(saveTimer); saveTimer = setInterval(report, 10000); });
  video.addEventListener("pause", () => { clear(playBtn).append(icon("play", 22)); playBtn.title = "Play"; el.classList.remove("playing"); clearInterval(saveTimer); report(); });
  video.addEventListener("ended", () => { clearInterval(saveTimer); if (opts.onEnded) opts.onEnded(); });
  video.addEventListener("volumechange", () => { clear(muteBtn).append(icon(video.muted || video.volume === 0 ? "mute" : "vol", 22)); if (!video.muted) vol.value = video.volume; });
  video.addEventListener("timeupdate", () => {
    const d = video.duration, live = !Number.isFinite(d);
    seek.hidden = live;
    if (!dragging && !live && d > 0) { seek.value = Math.round((video.currentTime / d) * 1000); seek.style.background = ""; }
    time.textContent = fmtTime(video.currentTime) + " / " + (live ? "LIVE" : fmtTime(d));
  });
  video.addEventListener("error", () => {
    if (hls || dash) return; // engines report their own errors
    const c = video.error && video.error.code;
    fail(c === 2 ? "network" : c === 3 ? "media" : c === 4 ? "unsupported" : "network", c === 4 ? "If this is a normal MP4, the link may be expired or the server may be refusing the request." : undefined);
  });
  seek.addEventListener("input", () => { dragging = true; if (Number.isFinite(video.duration)) video.currentTime = (Number(seek.value) / 1000) * video.duration; });
  seek.addEventListener("change", () => { dragging = false; });
  const wake = () => { el.classList.remove("idle"); clearTimeout(idleTimer); idleTimer = setTimeout(() => el.classList.add("idle"), 3000); };
  ["mousemove", "touchstart", "keydown", "click"].forEach((ev) => el.addEventListener(ev, wake));
  video.addEventListener("click", toggle);
  el.addEventListener("keydown", (e) => {
    if (e.target.matches("input,select")) return;
    const k = e.key;
    if (k === " " || k === "k") { e.preventDefault(); toggle(); }
    else if (k === "ArrowRight") video.currentTime += 5; else if (k === "ArrowLeft") video.currentTime -= 5;
    else if (k === "ArrowUp") { e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); } else if (k === "ArrowDown") { e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); }
    else if (k === "m") video.muted = !video.muted; else if (k === "f") fullscreen();
  });
  video.volume = Number(s.volume); video.playbackRate = Number(s.speed);
  const onHide = () => { if (document.visibilityState === "hidden") report(); };
  document.addEventListener("visibilitychange", onHide);

  return {
    el, video,
    setSources(list, startPos = 0) {
      sources = list; startAt = startPos;
      clear(srcSel).append(list.map((x, k) => h("option", { value: k }, `${x.type.toUpperCase()}${x.quality ? " " + x.quality : ""}${x.check && x.check.playable === false ? " (unavailable)" : ""}`)));
      srcSel.hidden = list.length < 2;
      const first = list.findIndex((x) => !x.check || x.check.playable !== false);
      load(first >= 0 ? first : 0);
    },
    destroy() { dead = true; report(); clearInterval(saveTimer); clearTimeout(idleTimer); document.removeEventListener("visibilitychange", onHide); stopEngines(); subBlobs.forEach((u) => URL.revokeObjectURL(u.url)); video.pause(); video.removeAttribute("src"); video.load(); },
  };
}