# Changelog

All notable changes to `@labelgrid/mcp` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
