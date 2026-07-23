# Changelog

All notable changes to `@labelgrid/core` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`@labelgrid/core` is primarily an internal shared client for the LabelGrid MCP
server and CLI — there are no API-stability promises before 1.0.

## [Unreleased]

### Added

- `MAX_UPLOAD_BYTES` (4 GiB) upload ceiling and a `FILE_TOO_LARGE` structured
  error. An oversized file is now rejected with an honest size-and-limit
  message instead of being mislabeled `FILE_NOT_FOUND`.
- `mintUpload`, `putToPresignedUrl` and `commitUpload` — the presigned upload
  flow's three steps are now individually exported and composed by
  `uploadViaPresignedUrl`, so an alternate transport can reuse mint + commit and
  swap only the byte-transfer step. Pure refactor; no behavior change.
- `LabelGridClient.getRaw(path, query?)` — an authenticated raw GET for file
  downloads that returns the live response for streaming, or the same
  normalized structured error as the JSON path, honoring the raw transfer
  timeout. Consolidates the duplicated authed-download helpers that lived in the
  MCP and CLI packages.

### Changed

- Presigned-URL uploads now stream the file from disk with an explicit
  `Content-Length` header instead of buffering the whole file into memory, so
  peak memory stays flat regardless of file size. (An explicit `Content-Length`
  is required — S3-compatible presigned PUTs reject a chunked body with 411.)
- Multipart uploads no longer make a redundant in-memory copy of the file bytes
  before building the form Blob.

### Fixed

- Multipart uploads (cover art, license documents) now use the longer raw
  transfer timeout instead of the 60s JSON request timeout, so a large file on
  a slow uplink is no longer aborted mid-upload.
- `raw()` now composes a caller-supplied `AbortSignal` with the transfer-timeout
  signal (`AbortSignal.any`) instead of letting the caller's signal silently
  replace and disable the timeout.

## [0.1.0] - 2026-07-20

### Added

- Initial release, extracted from the `@labelgrid/mcp` server: the LabelGrid
  public-API HTTP transport with structured errors and timeouts, presigned-URL
  and multipart upload flows with extension allowlists and symlink resolution,
  upload content-type resolution, the catalog-entity registry, and stderr-only
  logging with secret redaction.
