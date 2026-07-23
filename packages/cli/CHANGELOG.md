# Changelog

All notable changes to `@labelgrid/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Global `--timeout <ms>` and `--transfer-timeout <ms>` flags, plus the
  `LABELGRID_TIMEOUT_MS` and `LABELGRID_TRANSFER_TIMEOUT_MS` environment
  variables, to configure the JSON request and transfer timeouts. The flag beats
  the env var; a non-positive-integer value is ignored with a warning.
- `upload` and `download` now show an in-place transfer-progress line on an
  interactive terminal (bytes transferred, and the total when known). It is
  silent when stderr is not a TTY or under `--json`.

### Changed

- `download` now streams the file body straight to disk instead of buffering
  the whole file in memory, so large track assets and statements download with
  flat memory use. The `wx`-exclusive / `--force` overwrite discipline is
  unchanged.

## [0.1.1] - 2026-07-20

### Changed

- `release confirm-review` now asks for confirmation before calling the API,
  matching the other final release actions (`distribute`, `takedown`).
  Non-interactive scripts pass `--yes`, as before.

## [0.1.0] - 2026-07-20

### Added

- Initial release of the `labelgrid` command-line tool — a thin wrapper over
  the LabelGrid public API sharing its client (`@labelgrid/core`) with the
  `@labelgrid/mcp` server.
- Command groups: `auth` (login/logout/whoami/token-revoke), `catalog`
  (search/get/create/update/delete across labels, artists, writers,
  publishers, releases, tracks), `release` (validate/distribute/takedown/
  confirm-review/landing-config/short-url), `upload`, `download`, `asset`,
  `license`, `statement`, `transactions`, `royalties`, `analytics`,
  `webhook`, `review`, and `beatport`.
- Token handling: `LABELGRID_API_TOKEN` env var, a stored credential via
  `labelgrid auth login` (macOS Keychain, or a `0600` credentials file on
  other platforms), and a `--token` flag — resolved in that order. All
  output is scrubbed so a token value can never be echoed.
- Output modes: human-readable tables by default, the raw API response under
  `--json`. Exit codes: `0` success, `1` API/structured error, `2` usage.
- Destructive commands prompt `Type y to confirm` (skippable with `--yes`).
- Download safety: `--out` must be absolute, writes are exclusive
  (no overwrite without `--force`). Upload safety: per-type file-extension
  allowlists with symlink resolution.
