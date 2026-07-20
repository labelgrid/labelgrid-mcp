---
name: labelgrid-release
description: Release music through LabelGrid end to end — draft the release and its tracks, upload audio and artwork, validate, review the quality report, distribute to stores, and track delivery — using the LabelGrid MCP server and/or the labelgrid CLI, choosing the right vehicle for each step.
---

# Releasing music through LabelGrid

This skill walks an agent through the full release lifecycle on the LabelGrid public
API, and — just as importantly — tells you **which vehicle to reach for at each step**.

LabelGrid ships two tools over the same API surface (both thin wrappers — every rule
and validation lives on the server, so the two behave identically):

- **`@labelgrid/mcp`** — the Model Context Protocol server. 30 consolidated tools your
  AI client calls directly. Best for reasoning steps: drafting metadata, reading
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
| Final gated actions — validate, distribute, takedown | **Either** | The MCP path is gated behind the full-writes acknowledgment (env vars); the CLI path is gated behind an interactive confirmation. |

Rule of thumb: **reason with MCP, move files and batch with the CLI.** When only one is
available, it can do the whole job — the CLI covers uploads that the MCP server places
behind full writes, and the MCP server covers everything when no shell is available.

### Setup & safety gates (read once)

Both vehicles authenticate with a LabelGrid API token
(`LABELGRID_API_TOKEN`; the CLI can also store it via `labelgrid auth login`). The MCP
server has three fail-closed gates:

1. **Reads** — always on.
2. **Safe writes** (`LABELGRID_ENABLE_WRITES`, on by default) — reversible, draft-stage
   changes: creating/editing draft releases and tracks, labels, artists, notes, landing
   pages.
3. **Full writes** (`LABELGRID_ENABLE_FULL_WRITES`, **off by default**) — consequential,
   hard-to-reverse actions: finalized (immutable) asset uploads, `distribute_release`,
   `takedown_release`, `confirm_review`. To arm them the user sets **both**:

   ```bash
   LABELGRID_ENABLE_FULL_WRITES=true
   LABELGRID_FULL_WRITES_ACK=I accept responsibility for AI-driven distribution actions
   ```

   The acknowledgment must match exactly or full writes stay off.

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

### Step 3 — Add each track

One call per track, against the release id from Step 2.

- MCP: `create_catalog_item` with `entity: 'track'` and `fields`.
  Required on create: `release_id`, `disc`, `track_num`, `composition_type`, `artists`,
  `audio_ai_usage`, `composition_ai_usage`, `commercial_samples`, `audio_language`,
  `contributors`, and `recording_country` (ISO 3166-1 alpha-2, e.g. `"US"`). Optional:
  `titles`, `isrc`, `iswc`, `writers`, `publishers`, `splits`, and more. `idempotency_key`
  is honored for tracks.
- CLI: `labelgrid catalog create --type track --fields '<json>'`.

### Step 4 — Upload audio and artwork

Finalized files. **These become immutable once the release is distributed — upload the
final versions before distributing.**

- **CLI (preferred when a shell is available)** — streams the file bytes and needs no
  arming (you are present):

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

- MCP: `get_release_review` with `view: 'quality_report'`. Re-run the checks with
  `run_release_checks` (`check: 'refresh_quality_report'`) — the server applies an hourly
  refresh budget. Without the add-on the API returns a 403, surfaced verbatim.
- CLI: `labelgrid review quality-report --release <release-id>` (add `--refresh` to re-run
  the checks first).
- If Preflight QC placed the release **on hold**, accept it with `confirm_review` (MCP,
  full-write) or `labelgrid release confirm-review <release-id>` (CLI) after reviewing.

### Step 7 — Distribute (final, consequential)

The final submission that sends the release to the stores. Validate should pass first.
The server enforces the account's weekly submission limit.

- MCP: `distribute_release` — a **full-write** tool, so full writes must be armed and
  acknowledged. Pass `idempotency_key` and **reuse the same value** if you retry an
  unobserved call.
- CLI: `labelgrid release distribute <release-id>` — prompts for confirmation
  interactively (that confirmation is the acknowledgment); add `--idempotency-key <key>`
  for a safe retry, or `--yes` to skip the prompt in a script.

### Step 8 — Track delivery

Watch the per-outlet delivery pipeline (statuses such as pending review, processing,
scheduled, complete, error).

- MCP: `get_delivery_queue` — one entry per (release, outlet); filter by `release_id`,
  `outlet_id`, or `status`.
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

- MCP: `get_analytics` with `start_date` and `end_date` (both `YYYY-MM-DD`, window capped
  at 30 days); optionally narrow by `platform` (`SPOTIFY`, `ITUNES`, `APPLE_MUSIC`),
  `release_id`, `isrc`, `upc`, or `artist_names`.
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
- **Destructive CLI commands prompt.** `release distribute`, `release takedown`,
  `catalog delete`, `asset delete`, `license delete`, `beatport enable`, and the other
  destructive commands ask for confirmation before any API call. `--yes` skips the prompt
  only when the operator has deliberately chosen non-interactive mode.
- **Validation is free and repeatable — always validate before distribute.**
  `run_release_checks` (`check: 'validate'`) / `labelgrid release validate` changes
  nothing; run it, fix `errors_structured`, and re-run until clean, then distribute.
- **Uploads are immutable after distribution.** Upload the final audio and artwork before
  the distribute step; there is no editing them once the release is out.
- **The API owns validation.** Both tools are thin wrappers — pass fields through and let
  the server's structured errors (`VALIDATION_FAILED` with a field map, `FORBIDDEN` with
  the server's code) guide the fix. Never fabricate an ID, code, or field name; resolve it
  from `list_reference_data` or a `search_catalog` lookup.
