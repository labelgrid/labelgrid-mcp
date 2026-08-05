# Changelog

All notable changes to `@labelgrid/mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-08-05

### Added

- `get_analytics_rankings` — top-N rankings for a window, ordered by summed
  streams. `view: 'leaderboards'` ranks top artists, tracks or albums (`type`
  required); `view: 'placements'` ranks the playlists and radio containers
  driving streams.
- `get_rate_limit` — the account's API rate budget per category, with the
  ceiling, the remaining allowance and the window reset.
- 10 new analytics section keys (47 total): eight social and UGC sections
  (`social-usage-over-time`, `social-reach-over-time`, `social-platform-mix`,
  `social-top-tracks`, `social-territory`, `social-artist-reach`,
  `social-artist-reach-daily`, `soundcloud-engagement`) and two per-track daily
  series (`track-streams-daily`, `track-listeners-daily`, which need a
  `release_id`, `isrc` or `upc` scope).
- `ugc_platform` filter on `get_analytics`, narrowing the social and UGC
  sections.
- `AMAZON` as a `platform` filter value on `get_analytics` and
  `get_analytics_rankings` (11 total), matching the platforms the API accepts.
- `query_financials` concise mode now returns the fee fields — `labelgrid_fee`,
  `platform_fee_usd`, `ugc_fee_usd`, `labelgrid_rate` and `labelgrid_ugc_rate`.
  Previously a fee was visible only with `response_format: 'detailed'`.

### Changed

- Social and UGC sections report their own per-section availability in
  `meta.social_availability`; the streaming availability matrix does not cover
  them. A use, a view and a play are distinct quantities and are never summed
  with each other or with streams.
- `track-listeners-daily` sums each platform track entry's daily count. Where a
  track exists as more than one entry it is not a distinct count of people, and
  it is not summable across dates.
- Tool descriptions across the catalog were tightened. No tool names,
  parameters or behavior changed beyond the items above.

## [0.5.0] - 2026-07-27

### Added

- `get_analytics_availability` — one static call returning the section-by-platform
  `availability` matrix and the per-platform `platform_cadence` map (`daily` or
  `weekly`). Fetch it once before `get_analytics` so an unreported section is
  treated as unavailable rather than as an empty chart.
- 22 new analytics section keys (37 total), including library adds, shazams
  (plus by-city and by-state), playlist adds, detailed source split, discovery
  and repeat rates, listener plan mix, listeners by region, Apple streams by
  city, Apple discovery cohorts, average listen time, and hour-of-day.
- 7 new `platform` filter values (10 total): `DEEZER`, `BOOMPLAY`, `AWA`,
  `AUDIOMACK`, `KUGOU`, `KUWO`, `QQMUSIC`. The three Tencent platforms report
  weekly — one point per week carrying the whole week.

### Changed

- **Breaking:** `get_analytics` now requires `metrics` (1–12 section keys per
  request), matching the API contract. Split a larger selection across
  requests — responses are cached per scope and window.
- The reporting window cap rose from 30 to 400 days. Windows over 90 days draw
  a separate, lower rate budget; a 429 response carries `retry_after_seconds`.
- Tool descriptions across the catalog were tightened. No tool names,
  parameters, or behavior changed beyond the items above.

## [0.4.0] - 2026-07-23

### Added

- `LABELGRID_TIMEOUT_MS` and `LABELGRID_TRANSFER_TIMEOUT_MS` configure the JSON
  request timeout and the upload/download transfer timeout. A non-positive-
  integer value is ignored with a warning and the built-in default applies.
- `LABELGRID_DOWNLOAD_DIR` — the only directory `download_statement` may write a
  `save_to_path` into (default: `~/Downloads` if present, else the working
  directory). A path resolving outside it is refused with a structured error.

### Changed

- `download_statement` now streams both the invoice PDF and a saved CSV export
  straight to disk instead of buffering the whole file in memory. An inline CSV
  (no `save_to_path`) is read with a 10 MB byte ceiling enforced up front and
  mid-stream; a larger export returns `RESPONSE_TOO_LARGE` and must be saved to
  a path.

### Fixed

- `download_statement` now writes a `save_to_path` file via a temp sibling that
  is atomically linked into place, so a failed download never leaves a partial
  file, and reports `saved_to` as the realpath-resolved canonical path.

## [0.3.1] - 2026-07-20

### Changed

- Internal restructure: the repository is now an npm workspace and the shared
  LabelGrid API client (HTTP transport, uploads, content types, the
  catalog-entity registry, and redacting logging) moved into the
  `@labelgrid/core` package, which this server now depends on. No behavior
  change — the tool catalog, gating, toolsets, resources and responses are
  identical to 0.3.0.

## [0.3.0] - 2026-07-16

### Changed

- **BREAKING: the 83 per-endpoint tools were consolidated into 30 tools** that
  select their target with an argument (`entity`, `view`, `action`, `check`,
  `format`, `target`, `type`). Every 0.2.x capability is preserved — see the
  full old→new mapping in the README's
  [Migrating from 0.2.x](./README.md#migrating-from-02x) section.
- **BREAKING: toolsets regrouped into eight sets** — `account`, `reference`,
  `catalog`, `releases`, `insights`, `finance`, `webhooks`, `distribution`.
  Legacy set names (`identity`, `review`, `delivery`, `analytics`,
  `accounting`) are still accepted in `LABELGRID_TOOLSETS` and map silently to
  their current set.
- **The `webhooks` toolset is now off by default.** Name it explicitly in
  `LABELGRID_TOOLSETS` to enable it. The default connected surface is 21 tools;
  the setup-mode listing applies the same default.
- Large read responses default to a concise projection: reads marked with
  `response_format` keep only high-signal fields (ids always kept) unless
  `response_format: 'detailed'` is passed, which returns the verbatim API
  response.

### Added

- MCP resources: the nine reference datasets are exposed at
  `labelgrid://reference/{type}` alongside the `list_reference_data` tool.
- A tool-catalog token budget gate in CI (`npm run measure-tokens`) that fails
  when the full catalog's estimated context cost exceeds 8,000 tokens.

## [0.2.2] - 2026-07-16

### Changed

- API requests time out after 60 seconds (structured `TIMEOUT` error) and raw
  transfers after 10 minutes — a hung call can no longer hang a tool.
- CI and publish workflows install dependencies with `--ignore-scripts`.

## [0.2.1] - 2026-07-15

### Added

- Dockerfile (the server runs containerized; boots into setup mode without credentials).
- `glama.json` metadata and score badges.

### Changed

- Setup mode now lists the full tool catalog for introspection; every catalog
  tool returns setup guidance (`NOT_CONNECTED`) until a token is configured.

## [0.2.0] - 2026-07-15

### Added

- MCPB one-click bundle for Claude Desktop, attached to GitHub releases.

## [0.1.1] - 2026-07-15

### Changed

- Declare the MCP registry name in the npm package manifest (no functional change).

## [0.1.0] - 2026-07-15

First release.

### Added

- 83 tools over the LabelGrid public API, in ten toolsets: identity, reference
  data, catalog (labels, artists, writers, publishers, releases, tracks),
  release drafting, review & quality reads, analytics, accounting & royalties,
  delivery status, webhooks, and distribution.
- Three-tier safety model, fail-closed at registration and at call time:
  reads always on; safe writes on by default (`LABELGRID_ENABLE_WRITES=false`
  or `LABELGRID_READ_ONLY=true` to disable); full writes (distribution,
  takedowns, immutable uploads) off by default, requiring
  `LABELGRID_ENABLE_FULL_WRITES=true` plus an explicit acknowledgment sentence.
- Typed HTTP client with structured error normalization, byte-bounded
  responses, and optional caller-supplied idempotency keys on release/track
  creation and distribution.
- File-handling guardrails: per-tool extension allow-lists with symlink
  resolution, no-overwrite statement downloads, presigned uploads that never
  carry the API token.
- Legal and data-handling disclosures in the README, the MCP `instructions`
  field, and stderr at startup.
- CI (lint, typecheck, unit tests on Node 20/22, repository hygiene scan,
  API-coverage drift check), secret-gated sandbox contract suite, and
  release-triggered npm trusted publishing with provenance.
- MCP registry manifest (`server.json`).
- Setup mode: starting without a token launches a single `setup` tool that walks the user through creating and configuring their API token in chat.
