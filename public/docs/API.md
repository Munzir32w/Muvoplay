# API (v1)

Base path `/api/v1`. All routes except health and selftest require a signed-in user. Success: `{ "data": ... }`. Error: `{ "error": { "code", "message" } }` with a matching HTTP status (400 validation, 404, 409, 422, 429, 501, 502).

- `GET /health` status and database check
- `GET /selftest` offline unit tests
- `GET /extensions` installed, available, updates, builtin
- `POST /extensions/install` one of `builtin`, `repositoryId` + `extensionKey`, `manifestUrl`, `manifest`
- `POST /extensions/:id/enable` re-validates the manifest first
- `POST /extensions/:id/disable`
- `POST /extensions/:id/update`
- `DELETE /extensions/:id`
- `GET /repositories`, `POST /repositories` (`url`, `name`), `POST /repositories/:id/refresh`, `DELETE /repositories/:id`
- `POST /search` `query`, optional `providers`, `type`, `year`, `genre`
- `POST /catalog` optional `providers`, `page`, `limit`
- `POST /media/details` `mediaId`, optional `alternatives`
- `POST /media/episodes` `mediaId`
- `POST /media/streams` `id` (episode or media id), optional `mediaId`, `probe`. Each source gets a `check` with reachability, content type, DRM and CORS results.
- `POST /media/subtitle` `providerId`, `url`. Fetches one small subtitle file and returns WebVTT (SRT is converted). Not a media proxy.
- `GET /history` (`limit`, or `mediaId` + `episodeId`), `POST /history`, `DELETE /history` (all, or `mediaId`)
- `GET /favorites`, `POST /favorites`, `DELETE /favorites?mediaId=`

Limits: 60 scraping requests per minute per user, 20 installs or repository operations per minute, 50 extensions and 20 repositories per user.