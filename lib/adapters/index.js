import { AdapterError } from "lib/util.js";
import { UNSUPPORTED_REASONS } from "lib/manifest.js";
import { native } from "lib/adapters/native.js";
import { stremio } from "lib/adapters/stremio.js";

// CloudStream (.cs3) and Vega: the adapter interface exists, but no runtime is implemented.
// Calls fail explicitly instead of pretending to work.
function unsupported(format) {
  const fail = async () => { throw new AdapterError(UNSUPPORTED_REASONS[format] || "Unsupported extension format", "unsupported_format", 501); };
  return { catalog: fail, search: fail, details: fail, episodes: fail, streams: fail };
}

export function adapterFor(format) {
  if (format === "muvoplay-json") return native;
  if (format === "stremio") return stremio;
  return unsupported(format);
}