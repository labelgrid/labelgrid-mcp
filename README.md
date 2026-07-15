# LabelGrid MCP Server

[![npm version](https://img.shields.io/npm/v/%40labelgrid%2Fmcp)](https://www.npmjs.com/package/@labelgrid/mcp) [![LabelGrid MCP server](https://glama.ai/mcp/servers/@labelgrid/labelgrid-mcp/badges/score.svg)](https://glama.ai/mcp/servers/@labelgrid/labelgrid-mcp)

`@labelgrid/mcp` — the official [Model Context Protocol](https://modelcontextprotocol.io) server for [LabelGrid](https://labelgrid.com), the music distribution platform. Point Claude Desktop, Claude Code, Cursor, or any MCP client at your own LabelGrid account and manage your music catalog, releases, files, analytics, royalty accounting, webhooks, and distribution in natural language — it is a thin, typed wrapper over the LabelGrid public API, so every rule and validation stays on the server.

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

If you start the server without `LABELGRID_API_TOKEN`, it does not fail — it launches in **setup mode** and exposes a single `setup` helper. Just ask your AI client to "set up LabelGrid" and it will walk you through creating a token and adding it to your config. Once the token is set, restart your client and the full toolset loads automatically.

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
| `LABELGRID_TOOLSETS` | all | Comma-separated subset of toolsets to expose. |

Valid toolsets: `identity`, `reference`, `catalog`, `releases`, `review`, `analytics`, `accounting`, `delivery`, `webhooks`, `distribution`.

## Tool reference

<!-- TOOLS:BEGIN -->

_83 tools across 10 toolsets. This table is generated from the
tool definitions by `npm run gen-docs` — do not edit it by hand._

### Identity `identity`

| Tool | Gate | Description |
| --- | --- | --- |
| `get_me` | read | Return the authenticated LabelGrid account profile, including the release submission limit/quota and terms-acceptance status. Use this to confirm which account your API token belongs to before making other calls. |
| `revoke_api_token` | write | Revoke a LabelGrid API token. Pass token_id to revoke a specific token; omit it to revoke the token currently in use. WARNING: revoking the current token immediately ends this session — the server loses access and stops working until you configure a new token. |

### Reference data `reference`

| Tool | Gate | Description |
| --- | --- | --- |
| `list_reference_data` | read | Fetch a LabelGrid reference dataset used to resolve the IDs and codes that catalog and release tools expect. Pick ONE dataset with `type`: `genres` and `genre_categories` (values for primary/secondary/tertiary genre IDs), `languages` (audio and metadata language codes), `contributor_roles` (valid role names for track contributors), `instruments`, `distro_outlets` (the distribution outlets/stores available to your account), or `territories` (country/territory codes). Call this before creating or updating a release or track when you need a valid ID or code. |

### Catalog (labels, artists, writers, publishers, releases, tracks, files) `catalog`

| Tool | Gate | Description |
| --- | --- | --- |
| `list_labels` | read | List the labels in your account, paginated. A label groups your releases and carries default copyright, website and outlet settings. Use get_label for the full detail of one label. |
| `get_label` | read | Retrieve one label by id, including its settings and defaults. |
| `list_artists` | read | List the artists in your account, paginated. Filter by `artist_name` to find a specific artist. Use get_artist for one artist’s full profile and links. |
| `get_artist` | read | Retrieve one artist by id, including bio, identifiers and platform links. |
| `list_writers` | read | List the songwriters in your account, paginated. Filter by `name` or `ipi`. Writers are attached to tracks for composition credits and royalty splits. |
| `get_writer` | read | Retrieve one writer by id, including PRO/IPI identifiers and publisher link. |
| `list_publishers` | read | List the publishers in your account, paginated. Filter by `name` or `ipi`. Publishers are linked to writers for publishing administration. |
| `get_publisher` | read | Retrieve one publisher by id. |
| `list_releases` | read | List releases in your account, paginated. Filter by `label_id`, `is_live` (1 = live/distributed), `barcode_number` (UPC/EAN), or `cat` (catalog number). Use get_release for one release’s full metadata and track listing. |
| `get_release` | read | Retrieve one release by id, including its metadata, artwork state and track listing. |
| `list_tracks` | read | List tracks in your account, paginated. Filter by `release_id` to list a release’s tracks, or by `isrc`. Use get_track for one track’s full metadata, credits and splits. |
| `get_track` | read | Retrieve one track by id, including titles, contributors, writers, publishers and royalty splits. |
| `get_track_file` | read | Retrieve metadata about one of a track’s asset files (its stereo audio, Dolby Atmos audio, or lyrics file), including its processing state. This returns file information, not the bytes — use get_track_audio_download_url for a downloadable link. |
| `get_track_audio_download_url` | read | Return a time-limited, signed URL to download one of a track’s audio assets. `asset_type` selects the asset: audio_16, audio_24, and audio_32 are the WAV master at that bit depth; audio_preview_full and audio_preview_clip are the generated MP3 preview (full-length / clip). Returns { download_url, expires_in }; the URL expires roughly 10 minutes after it is issued, so request a fresh one when it lapses. Fetch the URL directly — do not send your API token to it. |
| `list_track_licenses` | read | List the licenses attached to a track (e.g. cover/mechanical or sample clearances), paginated. |
| `get_track_license` | read | Retrieve one license attached to a track by its license id. |
| `get_release_file` | read | Retrieve metadata about a release animated cover (motion artwork) video asset — the square or the tall/portrait cover video — including its processing state. |
| `create_label` | write | Create a new label. Pass its attributes in `fields`. |
| `update_label` | write | Update a label. Supply only the fields you want to change in `fields`. |
| `delete_label` | write | Delete a label. The API refuses to delete a label that still has releases — remove or reassign its releases first. |
| `upload_label_image` | write | Upload a label image from a local file. `image_type` selects which asset: logo, logo-dark (a dark-mode variant), or background. `file_path` must be a local image file. |
| `create_artist` | write | Create a new artist. Pass its attributes in `fields`. |
| `update_artist` | write | Update an artist. Supply only the fields you want to change in `fields`. |
| `delete_artist` | write | Delete an artist. The API refuses deletion when the artist is still referenced by releases or tracks. |
| `upload_artist_photo` | write | Upload an artist photo from a local file. `file_path` must be a local image file. |
| `create_writer` | write | Create a new songwriter. Pass its attributes in `fields`. |
| `update_writer` | write | Update a writer. Supply only the fields you want to change in `fields`. |
| `delete_writer` | write | Delete a writer. The API refuses deletion when the writer is still referenced by tracks. |
| `create_publisher` | write | Create a new publisher. Pass its attributes in `fields`. |
| `update_publisher` | write | Update a publisher. Supply only the fields you want to change in `fields`. |
| `delete_publisher` | write | Delete a publisher. The API refuses deletion when the publisher is still referenced by writers. |

### Releases & tracks (draft lifecycle) `releases`

| Tool | Gate | Description |
| --- | --- | --- |
| `create_release` | write | Create a new release in DRAFT state. Pass its metadata in `fields`. Required: content_type, label_id, artists, titles, cat (catalog number), artwork_ai_usage, primary_genre_id. Pass idempotency_key and reuse the SAME value if you retry a call whose outcome you did not observe — the server deduplicates by it for 24h; without a key each call is a new operation. Add tracks with create_track, then validate_release before distributing. |
| `update_release` | write | Update a release’s metadata. Supply only the fields you want to change in `fields`. Once a release has been submitted or distributed, some fields are locked: attempting to change a locked field returns a 403 with code RELEASE_LOCKED_FIELDS, surfaced verbatim so you can see exactly which fields cannot be changed. |
| `delete_release` | write | Delete a release. The API only allows deleting a draft that has never been submitted; it refuses to delete a release that has been submitted or distributed. |
| `create_track` | write | Create a track on a release. Pass its metadata in `fields`. Required: release_id, disc, track_num, composition_type, artists, audio_ai_usage, composition_ai_usage, commercial_samples, audio_language, contributors, and recording_country (a required ISO 3166-1 alpha-2 country code, e.g. "US"). Pass idempotency_key and reuse the SAME value if you retry a call whose outcome you did not observe — the server deduplicates by it for 24h; without a key each call is a new operation. |
| `update_track` | write | Update a track’s metadata. Supply only the fields you want to change in `fields`. As with releases, some fields lock once the parent release is submitted or distributed. |
| `delete_track` | write | Delete a track. Allowed while the parent release is an editable draft; the API refuses once the release is submitted or distributed. |
| `validate_release` | write | Run validation on a release and return any problems that would block distribution, as both a human-readable `errors` list and a machine-readable `errors_structured` list. This is a near-read check: it changes nothing and is safe to repeat. Run it before distributing. |
| `refresh_quality_report` | write | Re-run the Preflight QC automated checks and refresh the release’s quality report. Read the results with get_quality_report. The server applies an hourly refresh budget, so frequent calls may be rate-limited. Preflight QC is an optional add-on. |
| `update_landing_config` | write | Set the smart-link landing-page configuration for a release. `actions` uses the current (v2) action-list contract — each entry describes one call-to-action on the page. You can also set links_page_enabled, config_mode, page_style, custom_cta_text, custom_description, and pre_order_links. This replaces the landing configuration. |
| `create_release_short_url` | write | Create (or return the existing) short URL for a release’s smart-link landing page. Safe to repeat. |
| `add_review_issue_note` | write | Add a note to a release review issue — for example to explain a fix or add context for the reviewer. `review_issue_id` is the id of the issue (from list_review_issues). |

### Review & quality `review`

| Tool | Gate | Description |
| --- | --- | --- |
| `list_review_issues` | read | List the review issues raised against a release during its automated quality checks. `release_id` is required. Each issue carries a code (see list_issue_definitions for what each code means), severity, and whether it blocks distribution. Use this to see what a customer must fix before a release can go out. |
| `list_issue_definitions` | read | Retrieve the catalog of review issue definitions: each code’s human-readable title, description, severity and whether it blocks distribution. Use it to interpret the codes returned by list_review_issues and the quality report. Issue codes are string slugs. |
| `get_quality_report` | read | Retrieve the Preflight QC quality report for a release: the customer-facing issues found by the automated checks so you can review them before confirming the release into distribution. Preflight QC is an optional add-on — if your account does not have it enabled the API returns a 403, which is surfaced verbatim. |
| `list_stream_radar_flags` | read | List Stream Radar flags for your releases, paginated — early-warning flags from streaming-integrity monitoring that surface possible artificial-streaming activity so you can act early. Filter by status, severity, dsp, isrc, release_id, and the last-detected date range (detected_from/detected_to). Stream Radar is an optional add-on; without it the API returns a 403, surfaced verbatim. |
| `get_stream_radar_flag` | read | Retrieve one Stream Radar flag by id, with its full detail. Stream Radar is an optional add-on; without it the API returns a 403, surfaced verbatim. |

### Analytics `analytics`

| Tool | Gate | Description |
| --- | --- | --- |
| `get_analytics` | read | Retrieve a streaming analytics summary for your catalog in a single call. `start_date` and `end_date` (both YYYY-MM-DD) are required and the window is capped at 30 days by the server. Optionally narrow the result by `platform` (SPOTIFY, ITUNES, APPLE_MUSIC), `release_id`, `isrc`, `upc`, or `artist_names`. By default all 15 metric sections are returned; pass `metrics` to request only a subset. Available metrics: streams, listeners, saves, skips, shares, completion-rate, lyrics-view-rate, canvas-view-rate, device-split, source-split, saves-by-tier, streams-by-country, streams-by-gender, streams-by-age, shares-by-country. This endpoint is rate-limited (about 60 requests per minute); a 429 response carries retry_after_seconds. |

### Accounting `accounting`

| Tool | Gate | Description |
| --- | --- | --- |
| `list_statements` | read | List your royalty statements, paginated. Filter by label_id, release_id, isrc, upc, and a start_date/end_date range. Pass group_by="release" to roll the totals up per release. Use get_statement for one statement, or download_statement_csv for its line items. |
| `get_statement` | read | Retrieve one royalty statement by its invoice number. |
| `download_statement_csv` | read | Download statement line items as CSV. Pass invoice_number for a single statement, OR a start_date/end_date range to export across statements. If save_to_path (an absolute path whose parent directory exists) is given, the CSV is written there — an existing file is never overwritten (returns FILE_EXISTS) — and the tool returns the byte count. Otherwise the CSV is returned inline, truncated at 100KB (with truncated: true) — use save_to_path for large exports. |
| `download_statement_invoice` | read | Download the invoice PDF for a statement. save_to_path is REQUIRED (the PDF is binary) and must be an absolute path whose parent directory exists; the PDF is written there — an existing file is never overwritten (returns FILE_EXISTS) — and the tool returns the byte count. |
| `list_transactions` | read | List account transactions, paginated. Filter by label_id, release_id, isrc, upc, and a start_date/end_date range; sort with `sort`; pass group_by="release" to roll up per release. |
| `get_royalties_breakdown` | read | Get a cursor-paginated royalty breakdown grouped by one or more dimensions. group_by is REQUIRED and is a comma-separated, ordered subset of: track, dsp, release, territory, period (e.g. "release,dsp"). Filter by label_id, release_id, isrc, upc, and a start_date/end_date range. |
| `list_artificial_streams` | read | List the artificial-streaming records reported for your catalog, cursor-paginated — the per-record detail behind any artificial-streaming fee. Filter by dsp (spotify or apple), a start_date/end_date range, release_id, or isrc. |
| `get_artificial_fee_breakdown` | read | Retrieve the per-release breakdown of an artificial-streaming fee for one billing period. `period` is the month in YYYY-MM format. |
| `get_account_summary` | read | Retrieve your accounting summary — current balance and related account-level financial totals. |

### Delivery `delivery`

| Tool | Gate | Description |
| --- | --- | --- |
| `get_delivery_queue` | read | List the distribution queue entries for your account, paginated — one entry per (release, outlet) delivery with its current status (e.g. pending review, processing, scheduled, complete, error). Filter by `release_id`, `outlet_id`, or `status`. Use this to see where a release is in the delivery pipeline to each store. |
| `get_landing_config` | read | Retrieve the smart-link landing-page configuration for a release: whether the links page is enabled, its style/mode, custom copy, the action list and any pre-order links. Pair with update_landing_config to change it. |

### Webhooks `webhooks`

| Tool | Gate | Description |
| --- | --- | --- |
| `list_webhooks` | read | List the webhook subscriptions configured on your account, each with its URL, subscribed events and active state. |
| `get_webhook` | read | Retrieve one webhook subscription by id. |
| `get_webhook_logs` | read | Retrieve the recent delivery log for a webhook — the attempts, response codes and outcomes — to debug why events did or did not reach your endpoint. |
| `list_webhook_event_types` | read | List every available webhook event type, each with the schema of the payload it delivers. Use it to decide which events to subscribe a webhook to. |
| `create_webhook` | write | Create a webhook subscription. `name` and `url` (the HTTPS endpoint that will receive events) are required, along with `events` selecting which event types to deliver. The API returns a signing secret once on creation — store it to verify incoming payloads. |
| `update_webhook` | write | Update a webhook subscription. Supply only the fields you want to change: `name`, `url`, `events`, or `is_active` (set false to pause deliveries). |
| `delete_webhook` | write | Delete a webhook subscription permanently. It will stop receiving events. |
| `test_webhook` | write | Send a test event to a webhook’s endpoint so you can confirm it is reachable and your signature verification works. Safe to repeat. |
| `rotate_webhook_secret` | write | Generate a new signing secret for a webhook and return it. WARNING: the old secret stops working immediately — update your endpoint’s signature verification with the new secret right away or deliveries will fail verification. |

### Distribution (full writes) `distribution`

| Tool | Gate | Description |
| --- | --- | --- |
| `upload_track_audio` | full-write | Upload a finalized audio file (stereo WAV/FLAC or Dolby Atmos) or lyrics (LRC) file for a track. The file is uploaded directly to storage and then processed asynchronously; check its state with get_track_file. Once a release is distributed the file is immutable — upload the correct master before distributing. |
| `delete_track_audio` | full-write | Delete one of a track’s asset files (stereo, Dolby Atmos, or lyrics). Allowed only while the parent release is still an editable draft; the API refuses once the release is locked or distributed. |
| `upload_release_asset` | full-write | Upload a finalized animated cover (motion artwork) video for a release — the square or the tall/portrait cover video. The video is uploaded directly to storage and then processed; check its state with get_release_file. Upload the correct video before distributing — it is immutable once the release is live. For the static cover art image use upload_release_artwork. |
| `delete_release_asset` | full-write | Delete a release animated cover (motion artwork) video — the square or the tall/portrait cover video. Allowed only while the release is still an editable draft. |
| `upload_release_artwork` | full-write | Upload or replace the release’s static cover art image from a local file. Cover art is immutable once the release is distributed — upload the final artwork before distributing. |
| `upload_track_license` | full-write | Attach a license document to a track (for a cover or a cleared sample). `file_path` is the local license file and `type` is "cover" or "sample". Optionally record license_id, license_provider, license_provider_name, and original_track_link. Licenses are immutability-governed once the release is live. |
| `update_track_license` | full-write | Replace the file and/or metadata of an existing track license. `track_license_id` is the id of the license (from list_track_licenses); `file_path` is the license file to submit. Optionally update license_id, license_provider, license_provider_name, and original_track_link. |
| `delete_track_license` | full-write | Permanently delete a track license and its file. `track_license_id` is the license id (from list_track_licenses). This cannot be undone. |
| `distribute_release` | full-write | Submit a release for distribution to the stores/outlets — this is the FINAL, consequential action that sends the release out; validate_release should pass first. The server enforces your account’s weekly submission limit and returns a structured error if it is exceeded. Pass idempotency_key and reuse the SAME value if you retry a call whose outcome you did not observe — the server deduplicates by it for 24h; without a key each call is a new submission. |
| `takedown_release` | full-write | Take a release down from ALL outlets/stores — a final, consequential action that removes it everywhere it was delivered. Re-distribution afterward is a fresh submission. |
| `confirm_review` | full-write | Confirm a release that Preflight QC placed on hold, moving it into distribution review. Use after you have reviewed the quality report and accept the release as-is. Safe to repeat. |
| `enable_beatport` | full-write | Request Beatport onboarding for a label. This is a one-time action that cannot be un-requested once submitted, so confirm the label is correct first. |

<!-- TOOLS:END -->

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
