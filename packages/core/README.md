# @labelgrid/core

`@labelgrid/core` is the shared client library for the [LabelGrid](https://labelgrid.com) public API. It provides one surface for everything a LabelGrid tool needs to talk to the API: an HTTP transport that normalizes every failure into a structured error (never a thrown protocol exception), presigned-URL and multipart upload flows with file-extension allowlists and symlink resolution, upload content-type resolution, the catalog-entity registry (labels, artists, writers, publishers, releases, tracks and their endpoint paths), and stderr-only logging with secret redaction.

It is **primarily an internal package**: its reason to exist is to be the single implementation shared by the [`@labelgrid/mcp`](https://www.npmjs.com/package/@labelgrid/mcp) server and the [`@labelgrid/cli`](./../cli) command-line tool, which are both thin adapters over this client. It is published to npm so those packages can declare it as a regular dependency — not as a standalone, general-purpose SDK. If you are integrating with LabelGrid yourself, the [public API documentation](https://help.labelgrid.com/en/integrations/api-overview) is the supported surface.

Because of that, **there are no API-stability promises before 1.0**: minor releases may rename, reshape, or remove exports as the MCP server and CLI evolve. Pin an exact version if you depend on it directly, and expect to read the changelog when upgrading.

## License

[MIT](./LICENSE) © LabelGrid
