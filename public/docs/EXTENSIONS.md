# Extension format (.muvoplay.json)

An extension is one JSON manifest. It describes where to fetch data and how to map it. No code runs.

## Manifest

```json
{
  "schemaVersion": 1,
  "id": "example.media",
  "name": "Example Media",
  "version": "1.0.0",
  "description": "Authorized provider",
  "author": "You",
  "format": "muvoplay-json",
  "capabilities": ["catalog", "search", "details", "episodes", "streams"],
  "baseUrl": "https://media.example.com",
  "allowedDomains": ["media.example.com", "cdn.example.com"],
  "permissions": ["network"],
  "endpoints": {
    "catalog": { "type": "json", "url": "{baseUrl}/api/browse?page={page}", "itemsPath": "items",
      "map": { "id": "id", "title": "name", "poster": "image", "year": "year", "genres": "genres", "type": "kind" } },
    "search": { "type": "json", "url": "{baseUrl}/api/search?q={query}", "itemsPath": "results",
      "map": { "id": "id", "title": "name", "poster": "image" } },
    "details": { "type": "json", "url": "{baseUrl}/api/title/{id}",
      "map": { "title": "name", "description": "summary", "poster": "image", "genres": "genres[].name", "year": "year", "type": "kind" } },
    "episodes": { "type": "json", "url": "{baseUrl}/api/title/{id}/episodes", "itemsPath": "episodes",
      "map": { "id": "id", "title": "title", "number": "number", "season": "season" } },
    "streams": { "type": "json", "url": "{baseUrl}/api/play/{id}", "itemsPath": "sources",
      "map": { "url": "url", "type": "format", "quality": "quality", "subtitles": "subtitles" } }
  }
}
```

## Rules

- `id`: lowercase letters, digits, dot, dash, underscore (2 to 64 chars).
- `version`: semantic version. Higher versions in a repository show up under Updates.
- `capabilities`: any of catalog, search, details, episodes, streams. Each needs a matching endpoint. Unsupported capabilities are reported explicitly.
- `allowedDomains`: hostnames the extension may contact (subdomains included). No wildcards. Defaults to the baseUrl host.
- `permissions`: `network` (default), `external-media` (streams on other public domains), `subtitles`, `browser` (managed browser rendering).
- Template variables: `{baseUrl}`, `{query}`, `{id}`, `{mediaId}`, `{page}`, `{type}`. All except baseUrl are URL-encoded.

## Endpoint types

- `json`: `itemsPath` locates the list, `map` maps fields. Paths support `a.b[0].c` and `list[].name`. A value starting with `=` is a literal (`"type": "=movie"`). For details use `dataPath` for the object.
- `html`: `itemSelector` plus `fields`, each `{ "selector", "attr": "text|href|src|...", "regex" }`. Selectors: tag, `#id`, `.class`, `[attr=value]` (also `^= $= *= ~=`), descendant and `>`, comma groups, `:first-child`, `:last-child`, `:nth-child(n)`.
- `meta` (details): reads OpenGraph and JSON-LD from a page.
- `scan` (streams): finds mp4, m3u8, webm, mpd and vtt/srt URLs in a page. With `"render": "auto"` and the `browser` permission it falls back to a managed browser only if nothing was found.
- `direct` (streams): one URL template with `sourceType` (mp4, hls, webm, dash).
- `static`: data inside the manifest (`data`, or `"from": "catalog"`). Useful for a personal library. The built-in Demo extension uses this.

## Normalized types

MediaItem: id, providerId, title, alternativeTitles, poster, description, year, genres, type (movie, series, anime, other).
Episode: id, mediaId, title, number, season, thumbnail.
MediaSource: id, providerId, url, type (hls, mp4, webm, dash), quality, language, subtitles, expiresAt.

Ids are namespaced as `providerId~encodedRawId` so providers never collide.

## Stremio add-ons

Install from the add-on manifest URL. Catalogs, search, meta (including episodes) and stream resources are used. Torrent, YouTube and non-web-ready streams are skipped and listed under source diagnostics.

## Repository index

```json
{ "name": "My repo", "extensions": [ { "id": "my.source", "name": "My Source", "version": "1.0.0", "manifestUrl": "https://example.com/my.muvoplay.json" } ] }
```

Entries may also contain a full inline manifest. Entries are validated; invalid or unsupported ones appear under Failed with the reason. Nothing is enabled automatically.