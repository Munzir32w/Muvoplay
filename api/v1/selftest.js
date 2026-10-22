import { handler } from "lib/http.js";
import { assertSafeUrl, isBlockedIPv6 } from "lib/security.js";
import { validateNativeManifest, validateAnyManifest } from "lib/manifest.js";
import { getPath, mapItem, classifyMedia, discoverMedia, extractMeta, htmlList } from "lib/extract.js";
import { makeId, splitId, normalizeMedia, normalizeSources } from "lib/normalize.js";
import { compareSemver, expandTemplate, toVtt } from "lib/util.js";
import { DEMO_MANIFEST } from "lib/demo.js";
import { fromStremioManifest } from "lib/adapters/stremio.js";

export const access = "public";
export const methods = ["GET"];

// Offline unit tests (no network, no database). GET /api/v1/selftest
export default handler(async () => {
  const results = [];
  const t = (name, fn) => { try { const r = fn(); results.push({ name, pass: r === true, detail: r === true ? undefined : String(r) }); } catch (e) { results.push({ name, pass: false, detail: e.message }); } };
  const blocked = (u, o) => { try { assertSafeUrl(u, o); return false; } catch { return true; } };
  const allowed = (u, o) => !blocked(u, o);

  // SSRF
  for (const u of ["http://127.0.0.1/", "http://localhost/x", "http://10.0.0.5/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/", "http://0.0.0.0/", "http://224.0.0.1/", "http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[fd00:ec2::254]/", "http://[fc00::1]/",
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[64:ff9b::7f00:1]/", "http://[ff02::1]/", "http://2130706433/", "http://0x7f000001/", "http://017700000001/",
    "http://metadata.google.internal/", "http://printer.local/", "http://intranet/", "ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "http://user:pass@example.com/",
    "http://example.com:22/", "http://example.com:6379/", "", "not a url"]) t(`blocks ${u || "(empty)"}`, () => blocked(u) || `was allowed`);
  for (const u of ["https://example.com/", "http://example.com:8080/x", "https://sub.media.example.org/a.m3u8?token=1", "http://[2606:4700:4700::1111]/", "http://8.8.8.8/"]) t(`allows ${u}`, () => allowed(u) || "was blocked");
  t("allowlist permits subdomain", () => allowed("https://cdn.media.example.com/x", { allowedDomains: ["media.example.com"] }));
  t("allowlist blocks other domains", () => blocked("https://evil.com/x", { allowedDomains: ["media.example.com"] }));
  t("allowlist blocks suffix trick", () => blocked("https://notmedia.example.com.evil.com/", { allowedDomains: ["media.example.com"] }));
  t("ipv6 unparsable is refused", () => isBlockedIPv6("zzzz"));

  // Manifest validation
  const good = { schemaVersion: 1, id: "example.media", name: "Example", version: "1.0.0", description: "x", format: "muvoplay-json", capabilities: ["search"], baseUrl: "https://media.example.com", endpoints: { search: { type: "json", url: "{baseUrl}/s?q={query}", itemsPath: "results", map: { id: "id", title: "title" } } } };
  t("accepts valid manifest", () => validateNativeManifest(good).ok || "rejected");
  t("demo manifest is valid", () => { const v = validateNativeManifest(DEMO_MANIFEST); return v.ok || v.errors.join("; "); });
  const bad = (patch, label) => t(`rejects ${label}`, () => !validateNativeManifest({ ...good, ...patch }).ok || "was accepted");
  bad({ schemaVersion: 2 }, "schemaVersion 2"); bad({ id: "Bad Id" }, "bad id"); bad({ version: "1" }, "bad version"); bad({ format: "other" }, "bad format");
  bad({ capabilities: [] }, "empty capabilities"); bad({ capabilities: ["hack"] }, "unknown capability"); bad({ baseUrl: "http://127.0.0.1" }, "loopback baseUrl");
  bad({ baseUrl: "ftp://x.com" }, "ftp baseUrl"); bad({ allowedDomains: ["*"] }, "wildcard domains"); bad({ allowedDomains: ["other.com"] }, "baseUrl outside allowedDomains");
  bad({ endpoints: {} }, "missing endpoint for capability"); bad({ permissions: ["root"] }, "unknown permission");
  bad({ endpoints: { search: { type: "json", url: "https://evil.com/s", map: { id: "id", title: "t" } } } }, "endpoint on foreign domain");
  bad({ endpoints: { search: { type: "json", url: "{baseUrl}/s?{x}", map: { id: "id", title: "t" } } } }, "unknown template variable");
  bad({ endpoints: { search: { type: "json", url: "{baseUrl}/s", map: { id: "id" } } } }, "missing map.title");
  t("non-object manifest rejected", () => !validateNativeManifest(null).ok && !validateNativeManifest([]).ok);
  t("cloudstream reported unsupported", () => { const v = validateAnyManifest({ format: "cloudstream" }); return (!v.ok && !!v.unsupported) || "not flagged"; });
  t("vega reported unsupported", () => { const v = validateAnyManifest({ format: "vega" }); return (!v.ok && !!v.unsupported) || "not flagged"; });
  t("stremio manifest conversion", () => {
    const m = fromStremioManifest({ id: "org.test.addon", name: "T", version: "1.2.3", resources: ["catalog", "meta", { name: "stream" }], catalogs: [{ type: "movie", id: "top", extra: [{ name: "search" }] }] }, "https://addon.example.com/TOKEN/manifest.json");
    return (m.baseUrl === "https://addon.example.com/TOKEN" && m.capabilities.includes("streams") && m.capabilities.includes("search") && m.id === "stremio.org.test.addon") || JSON.stringify(m);
  });

  // Extraction
  t("getPath dot/bracket", () => getPath({ a: { b: [{ c: 5 }] } }, "a.b[0].c") === 5);
  t("getPath wildcard", () => JSON.stringify(getPath({ g: [{ n: "x" }, { n: "y" }] }, "g[].n")) === '["x","y"]');
  t("getPath blocks __proto__", () => getPath({}, "__proto__.polluted") === undefined && getPath({}, "constructor.prototype") === undefined);
  t("mapItem literal", () => mapItem({ a: 1 }, { id: "a", type: "=movie" }).type === "movie");
  t("classifyMedia", () => classifyMedia("https://x.com/a.m3u8?t=1") === "hls" && classifyMedia("https://x.com/a.mp4") === "mp4" && classifyMedia("https://x.com/a.mpd") === "dash" && classifyMedia("https://x.com/a") === "unknown" && classifyMedia("https://x.com/a", "application/vnd.apple.mpegurl") === "hls");
  t("discoverMedia finds sources and subtitles", () => {
    const html = '<video><source src="/v/a.mp4" type="video/mp4"></video><script>var u="https:\\/\\/cdn.x.com\\/p\\/master.m3u8?sig=1";</script><track src="/s/en.vtt" srclang="en" label="English">';
    const d = discoverMedia(html, "https://site.example.com/watch/1");
    return (d.sources.some((s) => s.type === "mp4") && d.sources.some((s) => s.type === "hls" && s.url.includes("cdn.x.com")) && d.subtitles.length === 1) || JSON.stringify(d);
  });
  t("extractMeta reads OpenGraph", () => extractMeta('<html><head><title>T</title><meta property="og:title" content="Hello"><meta property="og:image" content="/p.jpg"></head></html>', "https://x.example.com/").title === "Hello");
  t("htmlList CSS selectors", () => {
    const items = htmlList('<div class="c"><a href="/w/12"><h3>One</h3><img src="/p1.jpg"></a></div><div class="c"><a href="/w/13"><h3>Two</h3></a></div>',
      { itemSelector: ".c", fields: { id: { selector: "a", attr: "href", regex: "/w/(\\d+)" }, title: { selector: "h3" }, poster: { selector: "img", attr: "src" } } }, "https://x.example.com/list");
    return (items.length === 2 && items[0].id === "12" && items[0].title === "One" && items[0].poster === "https://x.example.com/p1.jpg") || JSON.stringify(items);
  });

  // Normalization
  t("id namespacing roundtrip", () => { const id = makeId("a.b", "x/y:1~2"); const s = splitId(id); return (s.providerId === "a.b" && s.rawId === "x/y:1~2") || id; });
  t("ids from different providers never collide", () => makeId("p1", "1") !== makeId("p2", "1"));
  t("splitId rejects malformed", () => splitId("nope") === null && splitId("~x") === null);
  t("normalizeMedia strips html and bad posters", () => { const m = normalizeMedia("p", { id: 1, title: "<b>Hi</b>", poster: "javascript:alert(1)", year: "2020-05", genres: "A, B", type: "Movie" }); return (m.title === "Hi" && m.poster === null && m.year === 2020 && m.genres.length === 2 && m.type === "movie") || JSON.stringify(m); });
  t("normalizeMedia rejects missing id/title", () => normalizeMedia("p", { title: "x" }) === null && normalizeMedia("p", { id: 1 }) === null);
  t("normalizeSources enforces domain policy", () => {
    const m = { allowedDomains: ["cdn.example.com"], permissions: ["network"], format: "muvoplay-json" };
    const r = normalizeSources("p", "1", [{ url: "https://cdn.example.com/a.mp4" }, { url: "https://evil.com/a.mp4" }, { url: "http://127.0.0.1/a.mp4" }, { url: "https://cdn.example.com/page" }], m);
    return (r.sources.length === 1 && r.rejected.length === 3) || JSON.stringify(r);
  });
  t("external-media permission lifts the domain list but not the SSRF rules", () => {
    const m = { allowedDomains: ["a.example.com"], permissions: ["network", "external-media"], format: "muvoplay-json" };
    const r = normalizeSources("p", "1", [{ url: "https://other.net/a.m3u8" }, { url: "http://10.0.0.1/a.mp4" }], m);
    return (r.sources.length === 1 && r.rejected.length === 1) || JSON.stringify(r);
  });
  t("subtitles validated per URL", () => {
    const m = { allowedDomains: ["cdn.example.com"], permissions: ["network"], format: "muvoplay-json" };
    const r = normalizeSources("p", "1", [{ url: "https://cdn.example.com/a.mp4", subtitles: [{ url: "https://cdn.example.com/en.vtt", lang: "en" }, { url: "https://evil.com/x.vtt" }] }], m);
    return r.sources[0].subtitles.length === 1 || JSON.stringify(r);
  });

  // Misc
  t("semver compare", () => compareSemver("1.2.0", "1.10.0") === -1 && compareSemver("2.0.0", "1.9.9") === 1 && compareSemver("1.0.0", "1.0.0") === 0);
  t("template encodes variables, keeps baseUrl", () => expandTemplate("{baseUrl}/s?q={query}", { baseUrl: "https://a.com/", query: "a b&c" }) === "https://a.com/s?q=a%20b%26c");
  t("SRT converts to WebVTT", () => toVtt("1\n00:00:01,000 --> 00:00:02,500\nHi\n").startsWith("WEBVTT") && toVtt("1\n00:00:01,000 --> 00:00:02,500\nHi\n").includes("00:00:01.000"));
  t("WebVTT passes through, garbage rejected", () => toVtt("WEBVTT\n\n00:01.000 --> 00:02.000\nHi") !== null && toVtt("<html>nope</html>") === null);

  const failed = results.filter((r) => !r.pass);
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, failures: failed, results: results.map((r) => ({ name: r.name, pass: r.pass })) };
});