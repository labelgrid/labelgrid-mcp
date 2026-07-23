# LabelGrid CLI

[![CI](https://github.com/labelgrid/labelgrid-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/labelgrid/labelgrid-mcp/actions/workflows/ci.yml)

`@labelgrid/cli` — the official command-line tool for [LabelGrid](https://labelgrid.com), the music distribution platform. Manage your catalog, releases, files, analytics, royalty accounting, webhooks, and distribution from the terminal or from scripts. The CLI is a thin, typed wrapper over the LabelGrid public API — every rule and validation stays on the server, and `--json` gives you the raw API response for scripting.

## Install

Node.js 20+ is required.

```bash
# Install globally
npm install -g @labelgrid/cli
labelgrid --version

# Or run on demand without installing
npx -y @labelgrid/cli auth whoami
```

The installed command is `labelgrid`.

## Authentication

You need a LabelGrid API token. API access is part of LabelGrid's [API plans](https://help.labelgrid.com/en/integrations/api-overview): sign in to your LabelGrid dashboard, go to **Profile → API Tokens**, and create a token. Treat it like a password — never commit it or paste it into a shared chat.

The CLI resolves a token in this order:

1. **`LABELGRID_API_TOKEN` environment variable** — highest precedence; ideal for CI and one-off shells.
2. **The stored token** from `labelgrid auth login` — on macOS it lives in the system Keychain (the token never touches the filesystem); on other platforms in `~/.config/labelgrid/credentials`, written mode `0600`.
3. **The `--token <token>` flag** — lowest precedence; for CI systems that inject secrets as arguments.

```bash
# Interactive setup: paste the token when prompted (or pipe it in)
labelgrid auth login

# Verify which account the resolved token belongs to
labelgrid auth whoami

# Remove the stored token
labelgrid auth logout
```

In CI, prefer the environment variable:

```bash
export LABELGRID_API_TOKEN=...   # from your CI secret store
labelgrid catalog search --type release --json
```

The CLI never echoes a token: every byte written to stdout or stderr is scrubbed, so a token value cannot appear in output even if an API response echoes it back.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `LABELGRID_API_TOKEN` | Your API token (highest-precedence credential). |
| `LABELGRID_API_URL` | Override the API base URL (the `--api-url` flag beats it). |
| `LABELGRID_TIMEOUT_MS` | JSON request timeout in milliseconds, default `60000` (the `--timeout` flag beats it). |
| `LABELGRID_TRANSFER_TIMEOUT_MS` | Upload/download transfer timeout in milliseconds, default `600000` (the `--transfer-timeout` flag beats it). |

## Global flags

Every command accepts these, written before or after the subcommand:

| Flag | Purpose |
| --- | --- |
| `--json` | Print the raw API response as JSON (for scripts and `jq`). |
| `--token <token>` | Supply a token on the command line (lowest precedence). |
| `--api-url <url>` | Override the API base URL for this invocation. |
| `--yes` | Skip confirmation prompts on destructive commands. |
| `--timeout <ms>` | JSON request timeout in milliseconds (a bad value is ignored with a warning). |
| `--transfer-timeout <ms>` | Upload/download transfer timeout in milliseconds. |

## Transfer progress

When stderr is an interactive terminal, `upload` and `download` show a single,
in-place line with the bytes transferred (and the total when known), refreshed
about twice a second. Progress is silent when stderr is not a TTY (piped or
redirected) or under `--json`, so scripts and machine-readable output are never
polluted. Cover-art uploads use a small buffered request and show no incremental
progress.

## Command groups

Run `labelgrid --help` or `labelgrid <group> --help` for full usage. One example per group:

### `auth` — authentication and token management

`login`, `logout`, `whoami`, `token-revoke [--token-id <id>]`

```bash
labelgrid auth whoami
```

### `catalog` — labels, artists, writers, publishers, releases, tracks

`search`, `get <id>`, `create`, `update <id>`, `delete <id>` — pick the kind with `--type label|artist|writer|publisher|release|track`. `search` takes repeatable `--filter k=v` pairs (passed through verbatim — the API owns validation); `create`/`update` take the payload as `--fields <json>` or `--fields-file <path>`. Release and track creates honor `--idempotency-key` to dedupe a retried call.

```bash
labelgrid catalog search --type release --filter label_id=123 --per-page 20
```

### `release` — the release lifecycle

`validate <id>` (safe, repeatable), `distribute <id>` (final, confirmed), `takedown <id>` (final, confirmed), `confirm-review <id>` (final, confirmed), `landing-config <id>`, `short-url <id>`

```bash
labelgrid release validate 456
```

### `track` — alias guidance

Tracks are catalog entities; `labelgrid track` prints the equivalent `catalog --type track` commands.

```bash
labelgrid catalog search --type track --filter release_id=456
```

### `upload` — finalized asset uploads

`labelgrid upload <file> --track <id>|--release <id> --type stereo|dolby|lyrics|cover-art|motion-square|motion-tall`. Track types (`stereo`, `dolby`, `lyrics`) need `--track`; release types (`cover-art`, `motion-square`, `motion-tall`) need `--release`.

```bash
labelgrid upload ./master.wav --track 789 --type stereo
```

### `download` — track audio and statement files

`--track <id> --type audio_16|audio_24|audio_32|preview_full|preview_clip`, or `--statement <invoice> --type csv|invoice`. Both write to `--out <absolute-path>`; add `--force` to overwrite an existing file.

```bash
labelgrid download --statement INV12345 --type csv --out /tmp/statement.csv
```

### `asset` — delete a track or release asset file

`labelgrid asset delete --track <id> --type stereo|dolby|lyrics` or `--release <id> --type motion-square|motion-tall`. Allowed only while the parent release is an editable draft.

```bash
labelgrid asset delete --track 789 --type lyrics
```

### `license` — track license documents (cover/sample clearances)

`list`, `add`, `update`, `delete` — files are `.pdf`/`.jpg`/`.jpeg`/`.png`.

```bash
labelgrid license add --track 789 --file ./clearance.pdf --type cover
```

### `statement` — royalty statements

`list` (with `--filter` and `--group-by release`), `get <invoice>`

```bash
labelgrid statement list --filter start_date=2026-01-01 --filter end_date=2026-03-31
```

### `transactions` — account transactions

```bash
labelgrid transactions list --group-by release
```

### `royalties` — royalty breakdowns and artificial-streaming data

`breakdown` (cursor-paginated; `--group-by` is an ordered subset of `track,dsp,release,territory,period`), `artificial-streams`, `artificial-fee --period YYYY-MM`

```bash
labelgrid royalties breakdown --group-by release,dsp --filter start_date=2026-01-01
```

### `analytics` — streaming analytics

`get --start <date> --end <date>` (max 30-day window), optionally `--metrics`, `--platform`, `--release-id`, `--isrc`, `--upc`.

```bash
labelgrid analytics get --start 2026-06-01 --end 2026-06-28 --metrics streams,listeners
```

### `webhook` — webhook subscriptions

`list`, `get <id>`, `create`, `update <id>`, `delete <id>`, `test <id>`, `rotate-secret <id>`, `logs <id>`. `create`/`update` take `--fields <json>` or `--fields-file <path>` with `name`, `url` (the HTTPS endpoint receiving deliveries), and `events` (the event-subscription object — see the [API documentation](https://help.labelgrid.com/en/integrations/api-overview) for the event types). The create response carries the signing secret ONCE — store it to verify incoming payloads.

```bash
labelgrid webhook create --fields-file ./hook.json
labelgrid webhook logs 42
```

### `review` — release review issues and QC reports

`issues --release <id>`, `quality-report --release <id> [--refresh]`, `note --issue <id> --text <t>`. Preflight QC is an optional add-on; without it the API returns a 403, surfaced verbatim.

```bash
labelgrid review issues --release 456
```

### `beatport` — Beatport onboarding

`enable --label <id>` — a one-time request that cannot be un-requested (confirmed).

```bash
labelgrid beatport enable --label 123
```

## `--json` and scripting

By default the CLI prints human-readable tables and `key: value` text. With `--json` it prints the **raw API response** to stdout, so it composes with `jq` and shell pipelines:

```bash
# Every live release id
labelgrid catalog search --type release --filter is_live=1 --json | jq -r '.data[].id'

# Bulk operations are shell loops (with --yes for non-interactive confirms)
labelgrid catalog search --type track --filter release_id=456 --json \
  | jq -r '.data[].id' \
  | while read -r id; do labelgrid catalog get "$id" --type track --json; done
```

**Exit codes:** `0` success · `1` API or structured error · `2` usage error (bad flags/arguments). Errors print as one line `CODE: message` on stderr; under `--json` the error JSON is also printed to stdout, so a pipeline can parse failures too:

```text
NOT_FOUND: No release found with that id.
```

Common codes match the API: `TOKEN_INVALID` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_FAILED` (422, with field errors), `RATE_LIMITED` (429), `SERVER_ERROR` (5xx), plus local ones such as `NO_TOKEN`, `INVALID_PATH`, `FILE_EXISTS`, and `NETWORK_ERROR`.

## Destructive commands and confirmation

Destructive commands — `catalog delete`, `release distribute`, `release takedown`, `asset delete`, `license delete`, `webhook delete`, `webhook rotate-secret`, `auth token-revoke`, `beatport enable` — prompt before acting:

```text
About to distribute release 456 to the stores.
Type y to confirm:
```

Anything other than `y`/`yes` aborts (exit 1) before any API call. Pass `--yes` to skip the prompt in scripts.

**How this differs from the LabelGrid MCP server:** the [MCP server](https://www.npmjs.com/package/@labelgrid/mcp) is driven by an AI agent, so its consequential actions are gated behind environment variables including an explicit acknowledgment sentence — nothing at runtime can ask a human. At a terminal, **you** are present for every command: the interactive confirmation (or your deliberate `--yes`) is the acknowledgment, so the CLI needs no environment arming.

## Download & upload safety

**Downloads** write with a deliberate discipline:

- `--out` must be an **absolute path** whose parent directory exists (symlinked parents are resolved; a dangling link is rejected).
- The write is **exclusive**: an existing file is never overwritten — you get `FILE_EXISTS` unless you pass `--force`.
- Track audio downloads fetch a short-lived signed URL from the API and then download the bytes directly from storage — your API token is never sent to the storage host.

**Uploads** are guarded before any byte leaves your machine:

- Each `--type` has a file-extension allowlist (for example `stereo` accepts `.wav`/`.flac`/`.aif`/`.aiff`; `cover-art` accepts common image formats), so the CLI cannot be pointed at an arbitrary file.
- Symlinks are resolved first and the allowlist is applied to the real target.
- The parent flag must match the type: track asset types require `--track`, release asset types require `--release`.
- Uploaded assets become immutable once the release is distributed — upload final files before distributing.

## License

[MIT](./LICENSE) © LabelGrid
