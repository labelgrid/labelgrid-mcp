# Changelog

All notable changes to `@labelgrid/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
