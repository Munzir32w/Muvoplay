# Muvoplay

Muvoplay is a media platform driven by extensions you choose. It ships no content, does not bypass DRM, authentication or access controls, and never runs extension code: extensions are declarative JSON that the server interprets.

## Stack and deviations from the original brief

- Hosting, database and auth: Hatchable (PostgreSQL, passwordless email login).
- Backend: Hatchable functions (V8 isolates) under `api/v1/*`, shared code in `lib/`.
- Frontend: plain ES modules, no build step. Hatchable has no build pipeline, so React, TypeScript and Tailwind were replaced by dependency-free modules and one CSS file with the specified design tokens.
- Validation: small built-in validators instead of Zod (no npm install on Hatchable).
- HTML extraction: built-in parser and CSS selector engine in `lib/html.js` (cheerio is not available).
- Row Level Security: Hatchable does not expose Supabase RLS. Every query is scoped by the signed-in user id in server code instead; the browser has no database access.
- Browser automation: Hatchable's managed browser (`browser.html`) replaces Playwright. It is used only when an endpoint sets `render: "auto"` and the plain fetch found no media.

## Run and deploy

The app is deployed on Hatchable. Migrations in `migrations/` run on deploy. No environment variables or secrets are required. To make it reachable by other people, set the project visibility to public in the Hatchable console.

## Structure

- `public/` frontend (index.html, css/, js/, js/pages/, docs/)
- `api/v1/` REST endpoints
- `lib/security.js` SSRF checks and guarded fetch
- `lib/manifest.js` manifest validation
- `lib/adapters/` muvoplay-json, stremio and unsupported-format adapters
- `lib/extract.js`, `lib/html.js` extraction and parsing
- `lib/normalize.js` internal types and id namespacing
- `lib/probe.js` source checks (reachability, DRM, CORS)

## Tests

`GET /api/v1/selftest` runs the offline unit tests (SSRF rules, manifest validation, extraction, normalization). Hatchable has no test runner, so the suite runs inside the same runtime as the app.

## Security summary

- Only http and https, no credentials in URLs, limited ports, private, loopback, link-local, multicast and metadata addresses blocked (IPv4 and IPv6, including mapped forms).
- Every redirect hop is re-validated; timeouts, size caps, redirect caps and per-user rate limits apply.
- Extensions can only reach their `allowedDomains`. Streams outside that list need the `external-media` permission and are still SSRF-checked.
- The isolate cannot resolve DNS itself, so resolved-IP filtering relies on Hatchable's egress proxy. This is a platform dependency, not something this app can verify.
- The page sets a Content-Security-Policy. `media-src` and `connect-src` allow https/http because media origins are chosen by extensions; the server restricts which origins an extension can offer.

## Not supported

- CloudStream `.cs3`: compiled Android packages, no browser or server runtime. Shown as Unsupported.
- Vega Provider: specification not verified, so no protocol is guessed. Shown as Unsupported.
- DRM streams, login-protected sources, torrent and YouTube streams from Stremio add-ons.
- Sources without browser CORS access (HLS and DASH) cannot be played without a proxy; no default proxy is provided.