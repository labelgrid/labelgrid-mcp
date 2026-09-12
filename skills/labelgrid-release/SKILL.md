---
name: labelgrid-release
description: Release music through LabelGrid end to end — draft the release and its tracks, upload audio and artwork, validate, review the quality report, distribute to stores, and track delivery — using the LabelGrid MCP server and/or the labelgrid CLI, choosing the right vehicle for each step.
---

# Releasing music through LabelGrid

This skill walks an agent through the full release lifecycle on the LabelGrid public
API, and — just as importantly — tells you **which vehicle to reach for at each step**.

LabelGrid ships two tools over the same API surface (both thin wrappers — every rule
and validation lives on the server, so the two behave identically):

- **`@labelgrid/mcp`** — the Model Context Protocol server. 33 tools in the full catalog;
  the configured toolsets and write gates determine which are available. Best for reasoning steps: drafting metadata, reading
  validation output, inspecting review issues.
- **`@labelgrid/cli`** — the `labelgrid` command-line tool. The same API from a shell,
  with `--json` for pipelines. Best for moving file bytes and for batch/CI work.

Everything below names the **exact tool, selector, flag, and environment variable** for
each vehicle. Nothing here is invented — if a step exists in only one vehicle, that is
called out.

## 1. Pick the right vehicle

| Step type | Vehicle | Why |
| --- | --- | --- |
| Judgment / reasoning — draft release & track metadata, resolve genre/language/outlet IDs, read validation errors, inspect review issues | **MCP tools** | The agent reasons over structured JSON already in context; no shell required. |
| Byte-moving & batch — upload audio/artwork, download masters/statements, loop over many releases or tracks, run in CI | **CLI** (`labelgrid …`) | Streams file bytes, pipes `--json` to `jq`, and drives shell loops. **Available only when the environment can execute shell commands.** |
| Final gated actions — distribute, takedown, confirm a QC hold | **Either** | The MCP path is gated behind the full-writes acknowledgment (env vars); the CLI path prompts for interactive confirmation. |

Rule of thumb: **reason with MCP, move files and batch with the CLI.** When only one is
available, it can do the whole job — each vehicle gates the consequential steps its own
way (full-writes arming for MCP, confirmation prompts for the CLI); neither path skips
the gate.

### Setup & safety gates (read once)

Both vehicles authenticate with a LabelGrid API token
(`LABELGRID_API_TOKEN`; the CLI can also store it via `labelgrid auth login`). The MCP
server has four fail-closed gate classes:

1. **Reads** — always on.
2. **Safe writes** (`LABELGRID_ENABLE_WRITES`, on by default) — reversible, draft-stage
   changes: creating/editing draft releases and tracks, labels, artists, notes, landing
   pages.
3. **Full writes** (`LABELGRID_ENABLE_FULL_WRITES`, **off by default**) — consequential,
   hard-to-reverse actions: finalized (immutable) asset uploads, `distribute_release`,
   `takedown_release`, `confirm_review`. To arm them the user sets **both**:

   ```bash
   LABELGRID_ENABLE_FULL_WRITES=true
   LABELGRID_FULL_WRITES_ACK='I accept responsibility for AI-driven distribution actions'
   ```

   The acknowledgment must match exactly or full writes stay off.

4. **Destructive writes** — `delete_catalog_item` and `revoke_api_token` require
   safe writes enabled **and** full writes armed with the flag and exact acknowledgment
   above. They are hidden by default. The `catalog` or `account` toolset must also be
   selected. Catalog deletion can permanently remove data; revoking the current token
   immediately ends its access.

`LABELGRID_READ_ONLY=true` overrides both write controls. Setting only
`LABELGRID_ENABLE_WRITES=false` disables safe and destructive writes but leaves
independently armed distribution tools available. These MCP gates do not change CLI
confirmation prompts.

Confirm which account your token belongs to (and see the release submission limit/quota)
before doing anything else:

- MCP: `get_account` with `view: 'profile'`
- CLI: `labelgrid auth whoami`

## 2. The end-to-end release workflow

### Step 1 — Look up reference data

Resolve the IDs and codes the create calls expect (genre, language, contributor role,
territory, outlet). Do this first so metadata is valid on the first write.

- MCP: `list_reference_data` with `type:` one of `genres`, `genre_categories`,
  `languages`, `contributor_roles`, `instruments`, `distro_outlets`, `territories`,
  `issue_definitions`, `webhook_event_types`. The same datasets are also MCP **resources**
  at `labelgrid://reference/{type}` — read the resource directly if your client surfaces
  resources, otherwise use the tool.
- Also resolve the owning label (and any existing artists) with
  `search_catalog` (`entity: 'label'` / `'artist'`), or CLI
  `labelgrid catalog search --type label` / `--type artist`.

For an existing release, use `search_catalog` with `entity: 'release'` and
`filters: { cat: 'CAT001' }` or `filters: { barcode_number: '<UPC/EAN>' }`. Keep UPC/EAN
values as strings to preserve leading zeros. Release title search is not a documented
filter. Read the returned ID with `get_catalog_item`; request `response_format: 'detailed'`
when inspecting nested metadata that concise mode may omit. Follow `meta`/`links` pagination
with `page` and `per_page`; a first page without a match is not an exhaustive search.

### Step 2 — Create the draft release

A release is created in **DRAFT** state; you add tracks to it next.

- MCP: `create_catalog_item` with `entity: 'release'` and `fields`.
  Required on create: `content_type`, `label_id`, `artists`, `titles`, `cat` (catalog
  number), `artwork_ai_usage`, `primary_genre_id`. Many optional fields (release/original
  dates, copyright lines, extra genres, per-outlet URLs). `idempotency_key` is honored for
  releases.
- CLI: `labelgrid catalog create --type release --fields '<json>'` (or
  `--fields-file <path>`), optionally `--idempotency-key <key>`.

Capture the returned release `id` — every later step needs it.

Example MCP arguments, using the nested shapes from the draft lifecycle contract test.
The IDs are illustrative: replace them with resolved account/reference IDs, use the actual
metadata and AI-use declarations, and choose the intended release date. This is a draft
payload, not evidence that the release is ready to distribute.

```json
{
  "entity": "release",
  "fields": {
    "content_type": "Single",
    "label_id": 10,
    "cat": "CAT001",
    "artwork_ai_usage": "none",
    "primary_genre_id": 20,
    "release_date": "2026-10-01",
    "artists": [{ "artist_id": 30, "artistic_role": "MainArtist" }],
    "titles": [{ "iso_code": "en", "text": "Example Release" }]
  }
}
```

### Step 3 — Add each track

One call per track, against the release id from Step 2.

- MCP: `create_catalog_item` with `entity: 'track'` and `fields`.
  Required on create: `release_id`, `disc`, `track_num`, `composition_type`, `artists`,
  `audio_ai_usage`, `composition_ai_usage`, `commercial_samples`, `audio_language`,
  `contributors`, and `recording_country` (ISO 3166-1 alpha-2, e.g. `"US"`). Optional:
  `titles`, `isrc`, `iswc`, `writers`, `publishers`, `splits`, and more. `idempotency_key`
  is honored for tracks.
- CLI: `labelgrid catalog create --type track --fields '<json>'`.

Example MCP arguments for one track. Replace `release_id` with the created draft ID;
resolve artist, language and contributor-role values for the actual credits. Contributor
`roles` is an object of role flags, not a string or an array. Add the real credits and
other fields required by the API for this track; the example only illustrates the shape.

```json
{
  "entity": "track",
  "fields": {
    "release_id": 123,
    "disc": 1,
    "track_num": 1,
    "composition_type": "original",
    "audio_ai_usage": "none",
    "composition_ai_usage": "none",
    "commercial_samples": "no",
    "audio_language": "en",
    "recording_country": "US",
    "artists": [{ "artist_id": 30, "artistic_role": "MainArtist" }],
    "titles": [{ "iso_code": "en", "text": "Example Track" }],
    "contributors": [{ "roles": { "Producer": true }, "ai_contribution": "none" }]
  }
}
```

### Step 4 — Upload audio and artwork

Finalized files. **These become immutable once the release is distributed — upload the
final versions before distributing.**

- **CLI (preferred when a shell is available)** — streams the file bytes. Uploads need
  no arming here because a file can simply be re-uploaded until the release is
  distributed; the irreversible step (distribute) keeps its own gate in both vehicles:

  ```bash
  labelgrid upload ./master.wav --track <track-id> --type stereo
  labelgrid upload ./cover.jpg  --release <release-id> --type cover-art
  ```

  Track types (`--track`): `stereo` (`.wav`/`.flac`/`.aif`/`.aiff`), `dolby` (`.wav`),
  `lyrics` (`.lrc`/`.txt`). Release types (`--release`): `cover-art` (image),
  `motion-square`, `motion-tall` (`.mp4`/`.mov`). Each type enforces an extension
  allowlist.

- **MCP (when no shell is available)** — `upload_asset` with `target:` one of
  `track_stereo`, `track_dolby`, `track_lyrics`, `release_cover_art`,
  `release_motion_square`, `release_motion_tall`, plus `id` (the track id for `track_*`,
  the release id for `release_*`) and a local `file_path`. **`upload_asset` is in the
  `distribution` toolset — it requires full writes armed** (see the safety gates above).
  Audio and motion artwork process asynchronously; check state with `get_asset`
  (`mode: 'info'`).

### Step 5 — Validate (free, repeatable — always before distribute)

Validation changes nothing and is safe to run as many times as you like.

- MCP: `run_release_checks` with `check: 'validate'`. It returns a human-readable
  `errors` list and a machine-readable `errors_structured` list of anything that would
  block distribution.
- CLI: `labelgrid release validate <release-id>`.

Fix any problems (Step 6 below), then re-run validate until it is clean.

### Step 6 — Review the quality report (if the account has Preflight QC)

Preflight QC is an optional add-on. If the account has it, review the customer-facing
quality report before confirming the release.

- MCP: `get_release_review` with `view: 'quality_report'`; request
  `response_format: 'detailed'` when assessing fields omitted from concise mode.
  Without the add-on the API returns a 403, surfaced verbatim. Missing or denied QC
  information is unavailable evidence, not a passing quality report. If a fresh report
  is needed, request it deliberately with `run_release_checks`
  (`check: 'refresh_quality_report'`); the server applies an hourly refresh budget.
  Do not refresh automatically just because the report is missing or denied.
- CLI: `labelgrid review quality-report --release <release-id>` (add `--refresh` to re-run
  the checks first).
- If Preflight QC placed the release **on hold**, accept it with `confirm_review` (MCP,
  full-write) or `labelgrid release confirm-review <release-id>` (CLI; prompts for
  confirmation) after reviewing. Accepting the hold sends the release onward toward
  distribution — do it only on explicit user direction, never to "unstick" a workflow.

### Step 7 — Distribute (final, consequential)

The final submission that sends the release to the stores. Validate should pass first.
The server enforces the account's weekly submission limit.

- MCP: `distribute_release` — a **full-write** tool, so full writes must be armed and
  acknowledged. Pass `idempotency_key` and **reuse the same value** if you retry an
  unobserved call.
- CLI: `labelgrid release distribute <release-id>` — prompts for confirmation
  interactively (that confirmation is the acknowledgment); add `--idempotency-key <key>`
  for a safe retry. `--yes` skips the prompt for non-interactive scripts — an agent
  passes it only when the user has explicitly instructed distributing that exact
  release, never on its own initiative.

### Step 8 — Track delivery

Read the API's canonical current state and delivery history for the release.

- MCP: `get_delivery_queue` with the required `release_id`; it accepts
  `response_format`, but no `outlet_id` or `status` filters. Interpret `state`,
  `currently_live`, `ever_submitted`, `ever_delivered` and the current `outlets` states.
  `ever_delivered: true` does not imply `currently_live: true`, for example after a
  takedown. The API interprets queue history; do not reconstruct current status from
  old queue attempts. An outlet's `customer_state` alone does not imply customer action:
  require `attention_owner: 'customer'` and non-null `customer_action_code` and `action_url`
  before presenting its customer action.
- The CLI has no delivery-queue command — use the `get_delivery_queue` MCP tool for this
  read.

## 3. Common branches

### Fixing validation errors

Read `errors_structured` from `run_release_checks` (`check: 'validate'`), then make a
**targeted** edit and re-validate:

- MCP: `update_catalog_item` with the matching `entity` (`'release'` or `'track'`) and
  only the fields you are changing.
- CLI: `labelgrid catalog update <id> --type release|track --fields '<json>'`.

Drafts are freely editable. Once a release is submitted or distributed some fields lock —
changing one returns a 403 with code `RELEASE_LOCKED_FIELDS` naming exactly which fields
cannot change.

For a 422 create/update failure, read the returned `error.errors` field map and any
`error.errors_structured` diagnostics. For example, if only `recording_country` is invalid,
correct that track with `fields: { recording_country: 'US' }` after confirming its actual
country. Preserve unrelated metadata and repeat validation.

### Results that are too large

`RESULT_TOO_LARGE` means the tool omitted a response it could not return within its
400,000-character text limit. Narrow a read with filters, pagination or concise mode.
For a write, the API operation may already have succeeded: inspect the resource or its
status before deciding whether to retry. An oversized response does not mean a write
failed, and the MCP server does not replay it. Retain the same idempotency key for any
retry of a release/track create or distribution call whose outcome remains unobserved.

### Review issues after submission

- MCP: `get_release_review` with `view: 'issues'` — each issue carries a `code` (see
  `list_reference_data` `type: 'issue_definitions'`), severity, and whether it blocks
  distribution. Explain a fix or add context with `add_review_issue_note`
  (`review_issue_id` comes from the issues view).
- CLI: `labelgrid review issues --release <release-id>` and
  `labelgrid review note --issue <issue-id> --text "<note>"`.

### Taking a release down

Removes it from **all** outlets — final and consequential; re-distribution afterward is a
fresh submission.

- MCP: `takedown_release` — **full-write** (same arming as distribute).
- CLI: `labelgrid release takedown <release-id>` — prompts interactively (or `--yes`).

### Analytics and royalties after release

- MCP: `get_analytics` with `start_date`, `end_date` (both `YYYY-MM-DD`, window capped
  at 400 days) and `metrics` (required, 1-12 section keys per request); optionally narrow
  by `platform` (e.g. `SPOTIFY`, `APPLE_MUSIC`, `DEEZER`, `AUDIOMACK`, `KUGOU`),
  `release_id`, `isrc`, `upc`, or `artist_names`. Call `get_analytics_availability`
  first to see which sections each platform reports and each platform's reporting
  cadence (KUGOU, KUWO and QQMUSIC report one point per week — do not average it
  across days).
- MCP: `query_financials` with `view:` `statements`, `statement_detail`, `transactions`,
  or `royalty_breakdown` (for `royalty_breakdown`, `group_by` is required — an ordered
  subset of `track,dsp,release,territory,period`).
- CLI: `labelgrid analytics get --start <date> --end <date>`,
  `labelgrid royalties breakdown --group-by release,dsp`,
  `labelgrid statement list`, `labelgrid transactions list`.

## 4. Safety notes

- **Never arm full writes silently.** `distribute_release`, `takedown_release`,
  `confirm_review`, and `upload_asset` only run when the user has set
  `LABELGRID_ENABLE_FULL_WRITES=true` **and** the exact `LABELGRID_FULL_WRITES_ACK`
  sentence. The user sets these — do not instruct them to bypass the gate, and do not
  treat a missing acknowledgment as something to work around. If a full-write tool is not
  available, that is the safe default doing its job: prepare and validate everything, and
  leave the irreversible submission as a deliberate, opt-in human step.
- **Deletion and token revocation need both write controls.** `delete_catalog_item`
  and `revoke_api_token` additionally require `LABELGRID_ENABLE_WRITES=true`. Confirm
  the exact entity or token with the user before invoking them; do not enable either
  write control or use the CLI to work around the user's MCP gate configuration.
- **Destructive CLI commands prompt.** `release distribute`, `release takedown`,
  `release confirm-review`, `catalog delete`, `asset delete`, `license delete`,
  `beatport enable`, and the other destructive commands ask for confirmation before any
  API call. `--yes` skips the prompt only when the operator has deliberately chosen
  non-interactive mode — an agent never adds `--yes` on its own initiative.
- **Validation is free and repeatable — always validate before distribute.**
  `run_release_checks` (`check: 'validate'`) / `labelgrid release validate` changes
  nothing; run it, fix `errors_structured`, and re-run until clean, then distribute.
- **Uploads are immutable after distribution.** Upload the final audio and artwork before
  the distribute step; there is no editing them once the release is out.
- **The API owns validation.** Both tools are thin wrappers — pass fields through and let
  the server's structured errors (`VALIDATION_FAILED` with a field map, `FORBIDDEN` with
  the server's code) guide the fix. Never fabricate an ID, code, or field name; resolve it
  from `list_reference_data` or a `search_catalog` lookup.
