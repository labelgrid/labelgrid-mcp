# Changelog

All notable changes to `@labelgrid/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`@labelgrid/core` is primarily an internal shared client for the LabelGrid MCP
server and CLI — there are no API-stability promises before 1.0.

## [Unreleased]

### Fixed

- Multipart uploads (cover art, license documents) now use the longer raw
  transfer timeout instead of the 60s JSON request timeout, so a large file on
  a slow uplink is no longer aborted mid-upload.

## [0.1.0] - 2026-07-20

### Added

- Initial release, extracted from the `@labelgrid/mcp` server: the LabelGrid
  public-API HTTP transport with structured errors and timeouts, presigned-URL
  and multipart upload flows with extension allowlists and symlink resolution,
  upload content-type resolution, the catalog-entity registry, and stderr-only
  logging with secret redaction.
