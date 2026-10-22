// Built-in Demo extension. It is a regular native manifest whose endpoints are "static",
// so it goes through the same validation, adapter and normalization pipeline as real extensions.
// All items are labelled Demo. Streams are public test media, not scraper output.
export const DEMO_MANIFEST = {
  schemaVersion: 1,
  id: "muvoplay.demo",
  name: "Muvoplay Demo",
  version: "1.0.0",
  description: "Demo catalog using openly licensed test media to exercise the player. Not a real source.",
  author: "Muvoplay",
  format: "muvoplay-json",
  demo: true,
  capabilities: ["catalog", "search", "details", "episodes", "streams"],
  baseUrl: "https://test-streams.mux.dev",
  allowedDomains: ["test-streams.mux.dev", "interactive-examples.mdn.mozilla.net"],
  permissions: ["network"],
  endpoints: {
    catalog: {
      type: "static",
      data: [
        { id: "bbb", title: "Big Buck Bunny (HLS test stream)", alternativeTitles: ["Demo HLS"], year: 2008, genres: ["Demo", "Animation", "Comedy"], type: "movie", description: "Demo item. Open Blender Foundation film (CC BY 3.0) served as an HLS test stream by Mux. Exercises the hls.js path." },
        { id: "flower", title: "Flower (MP4 and WebM sample)", alternativeTitles: ["Demo MP4"], year: 2017, genres: ["Demo", "Nature"], type: "movie", description: "Demo item. Short CC0 clip from MDN with MP4 and WebM sources, to exercise native playback and the source selector." },
        { id: "series", title: "Muvoplay Demo Series", alternativeTitles: ["Demo episodes"], year: 2026, genres: ["Demo", "Series"], type: "series", episodeCount: 2, status: "Demo", description: "Demo series with two episodes that reuse public test streams, to exercise episode navigation and previous/next." },
      ],
    },
    search: { type: "static", from: "catalog" },
    details: { type: "static", from: "catalog" },
    episodes: {
      type: "static",
      data: { series: [{ id: "s1e1", title: "Episode 1 (Demo)", number: 1, season: 1 }, { id: "s1e2", title: "Episode 2 (Demo)", number: 2, season: 1 }] },
    },
    streams: {
      type: "static",
      data: {
        bbb: [{ url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", type: "hls", quality: "Auto" }],
        flower: [
          { url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", type: "mp4", quality: "MP4" },
          { url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm", type: "webm", quality: "WebM" },
        ],
        s1e1: [{ url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", type: "hls", quality: "Auto" }],
        s1e2: [{ url: "https://test-streams.mux.dev/test_001/stream.m3u8", type: "hls", quality: "Auto" }],
      },
    },
  },
};

export const BUILTINS = { "muvoplay.demo": DEMO_MANIFEST };