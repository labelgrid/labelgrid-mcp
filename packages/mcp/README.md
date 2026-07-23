# LabelGrid MCP Server

[![npm version](https://img.shields.io/npm/v/%40labelgrid%2Fmcp)](https://www.npmjs.com/package/@labelgrid/mcp) [![CI](https://github.com/labelgrid/labelgrid-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/labelgrid/labelgrid-mcp/actions/workflows/ci.yml) [![LabelGrid MCP server](https://glama.ai/mcp/servers/@labelgrid/labelgrid-mcp/badges/score.svg)](https://glama.ai/mcp/servers/@labelgrid/labelgrid-mcp)

`@labelgrid/mcp` — the official [Model Context Protocol](https://modelcontextprotocol.io) server for [LabelGrid](https://labelgrid.com), the music distribution platform. Point Claude Desktop, Claude Code, Cursor, or any MCP client at your own LabelGrid account and manage your music catalog, releases, files, analytics, royalty accounting, webhooks, and distribution in natural language — 30 consolidated tools forming a thin, typed wrapper over the LabelGrid public API, so every rule and validation stays on the server.

## Quickstart

You need a LabelGrid API token (see [Getting a token](#getting-a-token)) and Node.js 20+. The server runs on demand via `npx` — nothing to install globally.

### Claude Desktop — one-click install

The quickest way in, with no config file to edit:

1. Download **`labelgrid.mcpb`** from the [latest release](https://github.com/labelgrid/labelgrid-mcp/releases/latest).
2. Double-click it, or open Claude Desktop → **Settings → Extensions** and drag the file in.
3. When prompted, paste your [LabelGrid API token](#getting-a-token) — or leave it blank and let the in-chat guided setup walk you through creating one.

To update later, download the newer `.mcpb` and install it over the old one. Prefer to configure it yourself, or using a different client? The manual `npx` setup below works everywhere.

### Claude Desktop — manual config

Add this to your `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "labelgrid": {
      "command": "npx",
      "args": ["-y", "@labelgrid/mcp"],
      "env": {
        "LABELGRID_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see the LabelGrid tools appear.

### Claude Code

```bash
claude mcp add labelgrid -e LABELGRID_API_TOKEN=your-token-here -- npx -y @labelgrid/mcp
```

### Cursor

Add this to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

```json
{
  "mcpServers": {
    "labelgrid": {
      "command": "npx",
      "args": ["-y", "@labelgrid/mcp"],
      "env": {
        "LABELGRID_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### First run / setup mode

If you start the server without `LABELGRID_API_TOKEN`, it does not fail — it launches in **setup mode**: the full tool catalog stays listed so you can see what the server offers, and a `setup` helper leads the way. Nothing can run in this state — every catalog tool returns setup guidance instead. Just ask your AI client to "set up LabelGrid" and it will walk you through creating a token and adding it to your config. Once the token is set, restart your client and the tools go live.

## Getting a token

API access is part of LabelGrid's [API plans](https://help.labelgrid.com/en/integrations/api-overview) — see the [API Overview and Quickstart](https://help.labelgrid.com/en/integrations/api-overview) for what the API offers and how to activate it.

1. Sign in to your LabelGrid dashboard.
2. Go to **Profile → API Tokens**. (If you don't see this option, your account doesn't have API access yet — the [API overview](https://help.labelgrid.com/en/integrations/api-overview) explains how to get it, or contact support.)
3. Create a token and copy it into your client config as `LABELGRID_API_TOKEN`.

Treat the token like a password: it grants access to your catalog. Never commit it or paste it into a shared chat. Revoke a token any time from the same screen (or with the `revoke_api_token` tool).

## Configuration

All configuration is via environment variables in your client config.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LABELGRID_API_TOKEN` | — | **Required.** Your API token. |
| `LABELGRID_API_URL` | production API | Override the API base URL. |
| `LABELGRID_ENABLE_WRITES` | `true` | Safe writes (create/update drafts, labels, artists, …). Set `false` for reads only. |
| `LABELGRID_ENABLE_FULL_WRITES` | `false` | Arm full writes — see [Safety model](#safety-model). Also requires the acknowledgment below. |
| `LABELGRID_FULL_WRITES_ACK` | — | Must equal the exact acknowledgment sentence to arm full writes. |
| `LABELGRID_READ_ONLY` | `false` | Force reads only; overrides both write flags. |
| `LABELGRID_TOOLSETS` | all except `webhooks` | Comma-separated subset of toolsets to expose. |
| `LABELGRID_TIMEOUT_MS` | `60000` | JSON request timeout in milliseconds. Must be a positive integer; a bad value is ignored with a warning. |
| `LABELGRID_TRANSFER_TIMEOUT_MS` | `600000` | Upload/download transfer timeout in milliseconds (for presigned uploads and statement downloads). Same validation. |
| `LABELGRID_DOWNLOAD_DIR` | `~/Downloads` if it exists, else the working directory | The only directory `download_statement` may write a `save_to_path` into; a path outside it is refused. |

Valid toolsets (8): `account`, `reference`, `catalog`, `releases`, `insights`, `finance`, `webhooks`, `distribution`.

- **`webhooks` is opt-in**: it is excluded from the default surface. Name it explicitly in `LABELGRID_TOOLSETS` (e.g. `LABELGRID_TOOLSETS=webhooks` or `catalog,releases,webhooks`) to enable the webhook tools.
- **Legacy toolset names** from 0.2.x (`identity`, `review`, `delivery`, `analytics`, `accounting`) are still accepted in `LABELGRID_TOOLSETS` and map silently to their current toolset (`account`, `releases`, `releases`, `insights`, `finance`).

The nine reference datasets are also exposed as MCP **resources** at `labelgrid://reference/{type}`; the `list_reference_data` tool serves the same data for clients that don't surface resources.

## Tool reference

<!-- TOOLS:BEGIN -->

_30 tools across 8 toolsets. This table is generated from the
tool definitions by `npm run gen-docs` — do not edit it by hand._

### Account `account`

| Tool | Gate | Description |
| --- | --- | --- |
| `get_account` | read | Read the authenticated LabelGrid account. Pick ONE view with `view`: `profile` returns the account profile — including the release submission limit/quota and terms-acceptance status — use it to confirm which account your API token belongs to before making other calls; `balance` returns your accounting summary — current balance and related account-level financial totals. |
| `revoke_api_token` | write | Revoke a LabelGrid API token. Pass token_id to revoke a specific token; omit it to revoke the token currently in use. WARNING: revoking the current token immediately ends this session — the server loses access and stops working until you configure a new token. |

### Reference data `reference`

| Tool | Gate | Description |
| --- | --- | --- |
| `list_reference_data` | read | Fetch a LabelGrid reference dataset used to resolve the IDs and codes the catalog and release tools expect. Pick ONE dataset with `type`: `genres` and `genre_categories` (genre IDs), `languages` (audio/metadata language codes), `contributor_roles`, `instruments`, `distro_outlets` (the outlets/stores available to your account), `territories` (country codes), `issue_definitions` (each review issue code’s title, description, severity and whether it blocks distribution; codes are string slugs), or `webhook_event_types` (every webhook event type with its payload schema). Call this when you need a valid ID or code. The same datasets are exposed as MCP resources at labelgrid://reference/{type}; this tool is the fallback for clients that don’t surface resources. |

### Catalog (labels, artists, writers, publishers, releases, tracks) `catalog`

| Tool | Gate | Description |
| --- | --- | --- |
| `search_catalog` | read | List catalog entities of one kind, paginated. Pick the kind with `entity`: label, artist, writer, publisher, release, or track. `filters` takes the endpoint’s own filter names, passed through verbatim — label: no documented filters — paginate with page/per_page. artist: artist_name (filter by artist name). writer: name (writer name), ipi (IPI number). publisher: name (publisher name), ipi (IPI number). release: label_id (owning label id), is_live (1 = live/distributed only), barcode_number (UPC/EAN), cat (catalog number). track: release_id (one release’s tracks), isrc (filter by ISRC). Use get_catalog_item for one entity's full detail. response_format:'detailed' returns the verbatim API response. |
| `get_catalog_item` | read | Retrieve one catalog entity by id, with its full detail — a label’s settings, an artist’s identifiers and links, a writer’s PRO/IPI, a release’s metadata and track listing, a track’s contributors and royalty splits. Pick the kind with `entity`: label, artist, writer, publisher, release, or track. response_format:'detailed' returns the verbatim API response. |
| `create_catalog_item` | write | Create a catalog entity. Pick the kind with `entity` and pass its attributes in `fields` — the API owns all validation. Required and common fields per entity: label — required: name, default_email; optional: support email, website/platform URLs, default copyright lines, isrc_base. artist — required: artist_name; optional: full_name, email, location, bios, isni, default_language, platform profile URLs. writer — required: first_name, last_name; optional: middle_name, display_credits, email, country, pro, ipi, isni, publisher_id (or publisher_name/publisher_pro/publisher_ipi). publisher — required: name; optional: ipi, pro, isni, controlled_publisher. release — required on create: content_type, label_id, artists, titles, cat (catalog number), artwork_ai_usage, primary_genre_id; many optional fields (dates, copyright lines, genres, per-outlet URLs). Once submitted or distributed some fields are locked — changing one returns a 403 with code RELEASE_LOCKED_FIELDS naming exactly which fields cannot change. track — required on create: release_id, disc, track_num, composition_type, artists, audio_ai_usage, composition_ai_usage, commercial_samples, audio_language, contributors, and recording_country (ISO 3166-1 alpha-2, e.g. "US"); optional: titles, isrc, iswc, writers, publishers, splits, and more. A release is created in DRAFT state — add tracks, then run the release checks before distributing. `idempotency_key` is honored for release and track only. |
| `update_catalog_item` | write | Update a catalog entity. Pick the kind with `entity`, supply only the fields you want to change in `fields` (same field sets as create_catalog_item). For releases: once submitted or distributed, some fields are locked — changing one returns a 403 with code RELEASE_LOCKED_FIELDS naming exactly which fields cannot change. Track fields lock the same way once the parent release is submitted or distributed. |
| `delete_catalog_item` | write | Delete a catalog entity by id. The API refuses deletes that would orphan data — label: refused while the label still has releases — remove or reassign its releases first. artist: refused while still referenced by releases or tracks. writer: refused while still referenced by tracks. publisher: refused while still referenced by writers. release: only a never-submitted draft can be deleted. track: allowed while the parent release is an editable draft; refused once submitted or distributed. |
| `upload_image` | write | Upload a label image or an artist photo from a local file. `target`: label_logo, label_logo_dark (a dark-mode variant), label_background, or artist_photo. `id` is the label id for label_* and the artist id for artist_photo. `file_path` must be a local image file. |
| `get_asset` | read | Read a track or release asset. Valid selector matrices: (1) mode='info', parent='track', asset stereo\|dolby\|lyrics — file metadata (not the bytes) incl. processing state. (2) mode='info', parent='release', asset square\|tall — animated cover (motion artwork) video metadata incl. processing state. (3) mode='download_url', parent='track', asset audio_16\|audio_24\|audio_32 (WAV master at that bit depth) or audio_preview_full\|audio_preview_clip (generated MP3 preview) — returns { download_url, expires_in }: a signed URL that expires roughly 10 minutes after issue; fetch it directly — do not send your API token to it. Any other combination has no endpoint and returns a structured error. mode defaults to info. |

### Releases (review, delivery, links, licenses, checks) `releases`

| Tool | Gate | Description |
| --- | --- | --- |
| `get_release_review` | read | Read a release's automated quality-check results. Pick ONE view with `view`: `issues` lists the review issues raised against the release — each carries a code (see list_reference_data type issue_definitions), severity, and whether it blocks distribution; use it to see what must be fixed before the release can go out. `quality_report` retrieves the Preflight QC quality report — the customer-facing issues found by the automated checks, to review before confirming the release into distribution; Preflight QC is an optional add-on — without it the API returns a 403, surfaced verbatim. response_format:'detailed' returns the verbatim API response. |
| `get_delivery_queue` | read | List the distribution queue entries for your account, paginated — one entry per (release, outlet) delivery with its current status (e.g. pending review, processing, scheduled, complete, error) — where a release is in the delivery pipeline to each store. Filter by `release_id`, `outlet_id`, or `status`. response_format:'detailed' returns the verbatim API response. |
| `get_landing_config` | read | Retrieve the smart-link landing-page configuration for a release: whether the links page is enabled, its style/mode, custom copy, the action list and any pre-order links. Pair with manage_release_links (action update_landing_config) to change it. |
| `list_track_licenses` | read | List the licenses attached to a track (e.g. cover/mechanical or sample clearances), paginated. Pass `license_id` to retrieve one license by its id instead. |
| `run_release_checks` | write | Run an automated check on a release. Pick ONE with `check`: `validate` returns any problems that would block distribution, as a human-readable `errors` list and a machine-readable `errors_structured` list — it changes nothing and is safe to repeat; run it before distributing. `refresh_quality_report` re-runs the Preflight QC checks and refreshes the quality report (read it with get_release_review view quality_report); the server applies an hourly refresh budget, so frequent calls may be rate-limited. Preflight QC is an optional add-on. |
| `manage_release_links` | write | Manage a release's smart-link landing page. Pick ONE action with `action`: `update_landing_config` replaces the landing-page configuration with `config` (required for this action) — `config.actions` uses the current (v2) action-list contract (one entry per call-to-action); other keys: links_page_enabled, config_mode, page_style, custom_cta_text, custom_description, pre_order_links. `create_short_url` creates (or returns the existing) short URL for the release's smart-link landing page — safe to repeat. |
| `add_review_issue_note` | write | Add a note to a release review issue — to explain a fix or add reviewer context. `review_issue_id` comes from get_release_review view issues. |

### Insights (analytics & artificial streaming) `insights`

| Tool | Gate | Description |
| --- | --- | --- |
| `get_analytics` | read | Retrieve a streaming analytics summary for your catalog in a single call. `start_date` and `end_date` (both YYYY-MM-DD) are required and the window is capped at 30 days by the server. Optionally narrow the result by `platform` (SPOTIFY, ITUNES, APPLE_MUSIC), `release_id`, `isrc`, `upc`, or `artist_names`. By default all 15 metric sections are returned; pass `metrics` (see its enum) to request only a subset. Rate-limited (about 60 requests per minute); a 429 response carries retry_after_seconds. |
| `query_artificial_streaming` | read | Query artificial-streaming (streaming-integrity) data for your catalog. Pick ONE view with `view`: `flags` lists Stream Radar early-warning flags surfacing possible artificial-streaming activity so you can act early, paginated — `filters`: status, severity, dsp, isrc, release_id, detected_from/detected_to (YYYY-MM-DD). `flag_detail` retrieves one flag by `flag_id` (required). Stream Radar is an optional add-on; without it the API returns a 403, surfaced verbatim. `records` lists the artificial-streaming records reported for your catalog, cursor-paginated — the per-record detail behind any artificial-streaming fee; `filters`: dsp (spotify or apple), start_date/end_date, release_id, isrc. `fee_breakdown` retrieves the per-release breakdown of an artificial-streaming fee for one billing period — `period` (required) is YYYY-MM. response_format:'detailed' returns the verbatim API response. |

### Finance (statements, transactions, royalties) `finance`

| Tool | Gate | Description |
| --- | --- | --- |
| `query_financials` | read | Query your financial data. Pick ONE view with `view`: `statements` lists your royalty statements, paginated — `filters`: label_id, release_id, isrc, upc, start_date/end_date; group_by="release" rolls totals up per release. `statement_detail` retrieves one statement by `invoice_number` (required). `transactions` lists account transactions, paginated — same `filters`; sort with `sort`; group_by="release" rolls up per release. `royalty_breakdown` returns a cursor-paginated royalty breakdown — `group_by` is REQUIRED for this view: a comma-separated, ordered subset of: track, dsp, release, territory, period (e.g. "release,dsp"); same `filters`; pass `cursor` to page. Use download_statement for statement line items (CSV) or the invoice PDF. response_format:'detailed' returns the verbatim API response. |
| `download_statement` | read | Download statement files. `format: 'csv'` downloads statement line items — pass invoice_number for one statement, OR a start_date/end_date range to export across statements; with save_to_path (an absolute path whose parent directory exists) the CSV is written there and the byte count returned; otherwise it is returned inline, truncated at 100KB (truncated: true) — use save_to_path for large exports. `format: 'invoice_pdf'` downloads the invoice PDF — invoice_number and save_to_path are both REQUIRED (the PDF is binary). An existing file is never overwritten (returns FILE_EXISTS). |

### Webhooks (off by default — enable via LABELGRID_TOOLSETS) `webhooks`

| Tool | Gate | Description |
| --- | --- | --- |
| `list_webhooks` | read | Read your webhook subscriptions. `view: 'config'` (the default) lists the webhook subscriptions configured on your account — each with its URL, subscribed events and active state — or retrieves one subscription when `webhook_id` is given. `view: 'logs'` retrieves the recent delivery log for a webhook (`webhook_id` required) — attempts, response codes and outcomes — to debug why events did or did not reach your endpoint. |
| `manage_webhook` | write | Manage a webhook subscription. Pick ONE action with `action`: `create` — pass `fields` with `name`, `url` (the HTTPS endpoint receiving deliveries) and `events` (the event subscription object — see list_reference_data type webhook_event_types); the API returns a signing secret ONCE on creation — store it to verify incoming payloads. `update` — supply only the fields to change in `fields`: name, url, events, or is_active (false pauses deliveries). `delete` — permanently removes the subscription; it stops receiving events. `test` — sends a test event to confirm reachability and signature verification; safe to repeat. `rotate_secret` — generates and returns a new signing secret — WARNING: the old secret stops working immediately; update your endpoint right away or deliveries will fail verification. `webhook_id` is required for every action except create. |

### Distribution (full writes) `distribution`

| Tool | Gate | Description |
| --- | --- | --- |
| `upload_asset` | full-write | Upload a finalized track or release asset from a local file. `id` is the track id for track_* targets, the release id for release_*. `track_stereo` (stereo audio, WAV/FLAC/AIFF), `track_dolby` (Dolby Atmos, WAV) and `track_lyrics` (LRC) upload directly to storage and process asynchronously — check state with get_asset (mode info). `release_cover_art` uploads or replaces the release's static cover art image. `release_motion_square` / `release_motion_tall` upload the animated cover (motion artwork) video — square or tall/portrait — also processed asynchronously. ALL of these become immutable once the release is distributed — upload the final files before distributing. |
| `delete_asset` | full-write | Delete a track or release asset file. track_stereo\|track_dolby\|track_lyrics delete a track asset; release_motion_square\|release_motion_tall delete an animated cover (motion artwork) video. Allowed only while the parent release is still an editable draft; the API refuses once the release is locked or distributed. Cover art has no delete endpoint and cannot be deleted here. |
| `manage_track_license` | full-write | Manage the license documents attached to a track (for a cover or a cleared sample). Pick ONE action with `action`: `upload` attaches a new license — `file_path` required, `type` ('cover' or 'sample') selects the kind; optionally record license_id, license_provider, license_provider_name, original_track_link. `update` replaces the file and/or metadata of an existing license — `track_license_id` (from list_track_licenses) and `file_path` required. `delete` permanently deletes a license and its file — `track_license_id` required; cannot be undone. Licenses are immutability-governed once the release is live. |
| `distribute_release` | full-write | Submit a release for distribution to the stores/outlets — the FINAL, consequential action that sends the release out; run_release_checks (check validate) should pass first. The server enforces your account’s weekly submission limit and returns a structured error if exceeded. Pass idempotency_key and reuse the SAME value when retrying an unobserved call; without a key each call is a new submission. |
| `takedown_release` | full-write | Take a release down from ALL outlets/stores — a final, consequential action that removes it everywhere it was delivered. Re-distribution afterward is a fresh submission. |
| `confirm_review` | full-write | Confirm a release that Preflight QC placed on hold, moving it into distribution review. Use after you have reviewed the quality report and accept the release as-is. Safe to repeat. |
| `enable_beatport` | full-write | Request Beatport onboarding for a label. A one-time action that cannot be un-requested, so confirm the label is correct first. |

<!-- TOOLS:END -->

## Migrating from 0.2.x

Version 0.3.0 is a **breaking release**: the 83 per-endpoint tools were consolidated into 30 tools that select their target with an argument (`entity`, `view`, `action`, `check`, `format`, `target`, `type`). Every 0.2.x capability is preserved — the table below maps each old tool to its new call. Toolsets were regrouped into eight sets (legacy set names are still accepted as aliases in `LABELGRID_TOOLSETS`), and the `webhooks` toolset is now off by default.

| Old tool (0.2.x) | New call (0.3.0) |
| --- | --- |
| `get_me` | `get_account` (`view: 'profile'`) |
| `get_account_summary` | `get_account` (`view: 'balance'`) |
| `revoke_api_token` | `revoke_api_token` (unchanged) |
| `list_reference_data` | `list_reference_data` (now 9 `type` values) |
| `list_issue_definitions` | `list_reference_data` (`type: 'issue_definitions'`) |
| `list_webhook_event_types` | `list_reference_data` (`type: 'webhook_event_types'`) |
| `list_labels` | `search_catalog` (`entity: 'label'`) |
| `list_artists` | `search_catalog` (`entity: 'artist'`) |
| `list_writers` | `search_catalog` (`entity: 'writer'`) |
| `list_publishers` | `search_catalog` (`entity: 'publisher'`) |
| `list_releases` | `search_catalog` (`entity: 'release'`) |
| `list_tracks` | `search_catalog` (`entity: 'track'`) |
| `get_label` | `get_catalog_item` (`entity: 'label'`) |
| `get_artist` | `get_catalog_item` (`entity: 'artist'`) |
| `get_writer` | `get_catalog_item` (`entity: 'writer'`) |
| `get_publisher` | `get_catalog_item` (`entity: 'publisher'`) |
| `get_release` | `get_catalog_item` (`entity: 'release'`) |
| `get_track` | `get_catalog_item` (`entity: 'track'`) |
| `create_label` | `create_catalog_item` (`entity: 'label'`) |
| `create_artist` | `create_catalog_item` (`entity: 'artist'`) |
| `create_writer` | `create_catalog_item` (`entity: 'writer'`) |
| `create_publisher` | `create_catalog_item` (`entity: 'publisher'`) |
| `create_release` | `create_catalog_item` (`entity: 'release'`) |
| `create_track` | `create_catalog_item` (`entity: 'track'`) |
| `update_label` | `update_catalog_item` (`entity: 'label'`) |
| `update_artist` | `update_catalog_item` (`entity: 'artist'`) |
| `update_writer` | `update_catalog_item` (`entity: 'writer'`) |
| `update_publisher` | `update_catalog_item` (`entity: 'publisher'`) |
| `update_release` | `update_catalog_item` (`entity: 'release'`) |
| `update_track` | `update_catalog_item` (`entity: 'track'`) |
| `delete_label` | `delete_catalog_item` (`entity: 'label'`) |
| `delete_artist` | `delete_catalog_item` (`entity: 'artist'`) |
| `delete_writer` | `delete_catalog_item` (`entity: 'writer'`) |
| `delete_publisher` | `delete_catalog_item` (`entity: 'publisher'`) |
| `delete_release` | `delete_catalog_item` (`entity: 'release'`) |
| `delete_track` | `delete_catalog_item` (`entity: 'track'`) |
| `upload_label_image` | `upload_image` (`target: 'label_logo'` \| `'label_logo_dark'` \| `'label_background'`) |
| `upload_artist_photo` | `upload_image` (`target: 'artist_photo'`) |
| `get_track_file` | `get_asset` (`parent: 'track'`, `mode: 'info'`, `asset: 'stereo'` \| `'dolby'` \| `'lyrics'`) |
| `get_release_file` | `get_asset` (`parent: 'release'`, `mode: 'info'`, `asset: 'square'` \| `'tall'`) |
| `get_track_audio_download_url` | `get_asset` (`parent: 'track'`, `mode: 'download_url'`, `asset: 'audio_16'` \| `'audio_24'` \| `'audio_32'` \| `'audio_preview_full'` \| `'audio_preview_clip'`) |
| `list_track_licenses` | `list_track_licenses` (unchanged) |
| `get_track_license` | `list_track_licenses` (`license_id: …`) |
| `list_review_issues` | `get_release_review` (`view: 'issues'`) |
| `get_quality_report` | `get_release_review` (`view: 'quality_report'`) |
| `list_stream_radar_flags` | `query_artificial_streaming` (`view: 'flags'`) |
| `get_stream_radar_flag` | `query_artificial_streaming` (`view: 'flag_detail'`, `flag_id: …`) |
| `list_artificial_streams` | `query_artificial_streaming` (`view: 'records'`) |
| `get_artificial_fee_breakdown` | `query_artificial_streaming` (`view: 'fee_breakdown'`, `period: 'YYYY-MM'`) |
| `get_analytics` | `get_analytics` (unchanged) |
| `get_delivery_queue` | `get_delivery_queue` (unchanged) |
| `get_landing_config` | `get_landing_config` (unchanged) |
| `list_statements` | `query_financials` (`view: 'statements'`) |
| `get_statement` | `query_financials` (`view: 'statement_detail'`, `invoice_number: …`) |
| `list_transactions` | `query_financials` (`view: 'transactions'`) |
| `get_royalties_breakdown` | `query_financials` (`view: 'royalty_breakdown'`, `group_by: …`) |
| `download_statement_csv` | `download_statement` (`format: 'csv'`) |
| `download_statement_invoice` | `download_statement` (`format: 'invoice_pdf'`) |
| `list_webhooks` | `list_webhooks` (`view: 'config'`, the default) |
| `get_webhook` | `list_webhooks` (`view: 'config'`, `webhook_id: …`) |
| `get_webhook_logs` | `list_webhooks` (`view: 'logs'`, `webhook_id: …`) |
| `create_webhook` | `manage_webhook` (`action: 'create'`) |
| `update_webhook` | `manage_webhook` (`action: 'update'`) |
| `delete_webhook` | `manage_webhook` (`action: 'delete'`) |
| `test_webhook` | `manage_webhook` (`action: 'test'`) |
| `rotate_webhook_secret` | `manage_webhook` (`action: 'rotate_secret'`) |
| `validate_release` | `run_release_checks` (`check: 'validate'`) |
| `refresh_quality_report` | `run_release_checks` (`check: 'refresh_quality_report'`) |
| `update_landing_config` | `manage_release_links` (`action: 'update_landing_config'`, `config: …`) |
| `create_release_short_url` | `manage_release_links` (`action: 'create_short_url'`) |
| `add_review_issue_note` | `add_review_issue_note` (unchanged) |
| `upload_track_audio` | `upload_asset` (`target: 'track_stereo'` \| `'track_dolby'` \| `'track_lyrics'`) |
| `upload_release_artwork` | `upload_asset` (`target: 'release_cover_art'`) |
| `upload_release_asset` | `upload_asset` (`target: 'release_motion_square'` \| `'release_motion_tall'`) |
| `delete_track_audio` | `delete_asset` (`target: 'track_stereo'` \| `'track_dolby'` \| `'track_lyrics'`) |
| `delete_release_asset` | `delete_asset` (`target: 'release_motion_square'` \| `'release_motion_tall'`) |
| `upload_track_license` | `manage_track_license` (`action: 'upload'`) |
| `update_track_license` | `manage_track_license` (`action: 'update'`, `track_license_id: …`) |
| `delete_track_license` | `manage_track_license` (`action: 'delete'`, `track_license_id: …`) |
| `distribute_release` | `distribute_release` (unchanged) |
| `takedown_release` | `takedown_release` (unchanged) |
| `confirm_review` | `confirm_review` (unchanged) |
| `enable_beatport` | `enable_beatport` (unchanged) |

## Safety model

The server has three gates. Each is fail-closed: a tool is only registered — and only callable — when its gate is armed.

1. **Reads** — always on. Listing and fetching your catalog, analytics, statements, and so on.
2. **Safe writes** (`LABELGRID_ENABLE_WRITES`, on by default) — reversible, draft-stage changes: creating and editing draft releases and tracks, labels, artists, writers, publishers, webhooks, landing pages, and notes. Set `LABELGRID_ENABLE_WRITES=false` (or `LABELGRID_READ_ONLY=true`) to turn these off.
3. **Full writes** (`LABELGRID_ENABLE_FULL_WRITES`, off by default) — consequential, hard-to-reverse actions. To arm them you must set **both**:

   ```bash
   LABELGRID_ENABLE_FULL_WRITES=true
   LABELGRID_FULL_WRITES_ACK=I accept responsibility for AI-driven distribution actions
   ```

   The acknowledgment string must match exactly, or full writes stay off. When armed, the `distribution` toolset becomes available. These tools can:

   - upload finalized (immutable) track audio and release artwork,
   - upload, update, and delete track licenses,
   - **distribute a release to stores** — a final submission subject to your account's weekly limit,
   - **take a release down from all stores**,
   - confirm a held release into review,
   - request one-time Beatport onboarding for a label.

Leaving `LABELGRID_ENABLE_FULL_WRITES` unset is the safe default: your AI assistant can prepare and validate everything, but the irreversible submission stays a deliberate, opt-in step.

## Rate limits & errors

Every tool returns either the API's JSON payload or a **structured error** — never a raw protocol failure — so your assistant can reason about what went wrong. The error shape is:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "The submitted data was invalid.",
    "status": 422,
    "errors": { "title": ["The title field is required."] }
  }
}
```

Common codes: `TOKEN_INVALID` (401 — check your token), `FORBIDDEN` (403 — plan/permission or a locked field, with the server's code passed through), `NOT_FOUND` (404), `VALIDATION_FAILED` (422, with `errors`), `RATE_LIMITED` (429), `SERVER_ERROR` (5xx), `NETWORK_ERROR`, and `FILE_NOT_FOUND` / `UPLOAD_FAILED` for local file operations.

**Rate limits.** A `429` is surfaced with a `retry_after_seconds` field (from the API's `Retry-After` header). The server does **not** auto-retry — your client decides when to try again. Analytics is limited to roughly 60 requests per minute.

## Contributing

Issues and pull requests are welcome. An API-coverage drift check runs in CI against a committed snapshot of the public API document and fails when the snapshot gains an endpoint this server does not expose (refresh the snapshot with `node scripts/fetch-openapi.mjs`). This repo uses:

- **TypeScript** (strict ESM), Node 20+, with `@modelcontextprotocol/sdk` and `zod` as the only runtime dependencies.
- **[Biome](https://biomejs.dev)** for lint + format (`npm run lint`).
- **[Vitest](https://vitest.dev)** for tests (`npm test`).

Local workflow:

```bash
npm ci
npm run build        # tsc
npm test             # unit tests
npm run lint         # biome
npm run leak-guard   # repository hygiene scan
npm run gen-docs     # regenerate the tool table above (after build)
```

Every tool is a thin declaration — one HTTP call plus response shaping, no client-side business logic. Please keep it that way: validation and rules belong on the server. The tool table in this README is generated (`npm run gen-docs`); edit tool descriptions in `src/tools/`, not the table.

## Legal notices

These disclosures are also surfaced at runtime: in the MCP `instructions` field your client receives on initialize, and on stderr at startup. The text below mirrors the runtime constants in `src/legal.ts`.

- **Summary.** This software is provided AS-IS, without warranty of any kind, express or implied. By using it you accept sole responsibility for your use of the LabelGrid API and for every action taken by any AI client or agent you connect to this server, including write operations against your LabelGrid account. Your use of the API through this server is governed by the LabelGrid API Terms of Service and Acceptable Use Policy. This server does not bypass server-side protections such as rate limits, plan entitlements, or terms enforcement. See [LICENSE](./LICENSE) (MIT).
- **Full writes.** When full writes are armed: distribution submissions, takedowns, and immutable file uploads initiated by an AI agent have real, potentially irreversible consequences for your releases on streaming platforms and stores. By setting the `LABELGRID_FULL_WRITES_ACK` acknowledgment variable you accepted that all such actions are your sole responsibility.
- **Data handling.** This server transmits your LabelGrid catalogue and account data to the AI client you configure. Choosing that client, and disclosing that data flow where required, is your responsibility.

## License

[MIT](./LICENSE) © LabelGrid
