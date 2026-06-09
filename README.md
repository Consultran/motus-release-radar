# MOTUS Release Radar

Tracks the deployed version of **[motus.dot.gov](https://motus.dot.gov)** — FMCSA's USDOT
Registration System — over time, so there's a public, timestamped record of *when* FMCSA ships
new versions and *what changed*.

A scheduled job checks the site **hourly** and appends a new entry **only when a version changes**,
so every row below is a real deploy. Liveness of the checker is visible in the
[Actions](../../actions) tab.

## What's tracked

| Field | Where it comes from | Notes |
|---|---|---|
| **Build** | site footer | Frontend build timestamp (only on the page, not the API) |
| **Web Version** | site footer | Frontend bundle version (only on the page, not the API) |
| **Server Version** | site footer + API | Backend version |
| **Seeder Version** | site footer + API | Data seeder version |
| **DB Migration Version** | site footer + API | Migration timestamp (`migrationTimestamp`) |
| **Migration #** | API only | Numeric `migrationVersion` — not shown in the footer |

The footer is JavaScript-rendered, so capture uses a headless browser (Playwright). The same run
also reads the public, unauthenticated endpoint `GET /api/auth/version` for the numeric migration
number and `nodeEnv`.

## Files

- [`data/versions.ndjson`](data/versions.ndjson) — append-on-change log; one JSON record per deploy.
- [`data/latest.json`](data/latest.json) — current values + last-checked timestamp + status. Stable
  file for downstream consumers (e.g. motusbugs.com) to read.
- [`data/errors.ndjson`](data/errors.ndjson) — capture failures (site unreachable / footer missing).

## Run it yourself

```sh
bun install
bunx playwright install chromium
bun run check
```

## Version history

<!-- CHANGELOG:START -->
| Detected (UTC) | Build | Web | Server | Seeder | DB Migration | Migration # |
|---|---|---|---|---|---|---|
| 2026-06-09T02:50:13.993Z | Jun 8, 2026, 7:09:38 PM EDT | 1.1.35 | 1.2.50 | 97 | 2026-06-08T1200 | 413 |
| 2026-06-08T09:18:31.971Z | Jun 7, 2026, 9:27:58 PM EDT | 1.1.35 | 1.2.50 | 97 | 2026-06-06T1500 | 412 |
| 2026-06-07T05:17:00.809Z | Jun 6, 2026, 7:57:57 PM EDT | 1.1.35 | 1.2.49 | 97 | 2026-06-06T1500 | 412 |
| 2026-06-06T06:47:29.204Z | Jun 5, 2026, 10:54:07 PM EDT | 1.1.35 | 1.2.48 | 97 | 2026-06-05T1430 | 409 |
| 2026-06-05T06:59:10.329Z | Jun 4, 2026, 7:18:34 PM EDT | 1.1.35 | 1.2.47 | 97 | 2026-06-03T1200 | 408 |
| 2026-06-04T19:29:59.579Z | Jun 3, 2026, 10:47:42 PM EDT | 1.1.35 | 1.2.47 | 97 | 2026-06-03T1200 | 408 |
<!-- CHANGELOG:END -->
