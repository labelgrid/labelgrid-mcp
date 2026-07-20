# LabelGrid MCP — workspace

[![CI](https://github.com/labelgrid/labelgrid-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/labelgrid/labelgrid-mcp/actions/workflows/ci.yml)

The official [LabelGrid](https://labelgrid.com) tooling for the LabelGrid public API, organised
as an npm workspace.

**Looking for the MCP server docs?** They live in
[`packages/mcp/README.md`](./packages/mcp/README.md) — installation for Claude Desktop / Cursor /
any MCP client, the full tool reference, safety gating, and configuration.

## Packages

| Package | What it is |
| --- | --- |
| [`@labelgrid/mcp`](./packages/mcp) | The MCP server — 30 consolidated tools over the LabelGrid public API. Published to npm; also ships as the `labelgrid.mcpb` one-click bundle for Claude Desktop. |
| [`@labelgrid/core`](./packages/core) | The shared API client: HTTP transport with structured errors, presigned-URL uploads, content-type allowlists, the catalog-entity registry, and redacting logging. Used by every LabelGrid tool built on the public API. |

## Layout & build arrangement

- The root `package.json` is a **private workspaces manifest**; its scripts fan out to the
  packages (`npm run build` builds `@labelgrid/core` first, then `@labelgrid/mcp`; `npm test`
  runs each package's suite).
- Each package has its **own `tsconfig.json`** extending the shared `tsconfig.base.json`
  (no TypeScript project references — the explicit root build chain keeps ordering correct and
  simple). `@labelgrid/mcp` imports `@labelgrid/core` through the workspace link and compiles
  against its built declarations.
- Unit tests run per package via each package's `vitest.config.ts`. The MCP package aliases
  `@labelgrid/core` to the sibling package's TypeScript source, so running tests never requires
  a prior core build.
- Repo-wide checks live in `scripts/` and run from the root: `npm run lint`,
  `npm run leak-guard`, `npm run check-coverage`, `npm run gen-docs`, `npm run measure-tokens`.

## Development

```bash
npm ci            # install the whole workspace
npm run build     # build core, then mcp
npm test          # unit suites for every package
npm run lint      # biome over the repo
```

The MCP server binary after a build: `node packages/mcp/dist/index.js` (or `npm start`).

## License

[MIT](./LICENSE)
