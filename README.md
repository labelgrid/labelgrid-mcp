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
| [`@labelgrid/cli`](./packages/cli) | The `labelgrid` command-line tool — the same API surface for terminals and scripts: catalog, releases, files, analytics, royalties, webhooks, and distribution, with `--json` output for pipelines. |
| [`@labelgrid/core`](./packages/core) | The shared API client: HTTP transport with structured errors, presigned-URL uploads, content-type allowlists, the catalog-entity registry, and redacting logging. Used by every LabelGrid tool built on the public API. |

## Command-line tool

Full docs (auth setup, every command group, scripting, safety model) live in
[`packages/cli/README.md`](./packages/cli/README.md). Quickstart:

```bash
npm install -g @labelgrid/cli          # Node 20+; installs the `labelgrid` command
export LABELGRID_API_TOKEN=...         # or run `labelgrid auth login`
labelgrid auth whoami                  # verify the token
labelgrid catalog search --type release --json | jq '.data[].id'
```

## Layout & build arrangement

- The root `package.json` is a **private workspaces manifest**; its scripts fan out to the
  packages (`npm run build` builds `@labelgrid/core` first, then `@labelgrid/mcp` and
  `@labelgrid/cli`; `npm test` runs each package's suite). Contributors work from the repo
  root: `packages/core` is the shared client, `packages/mcp` the MCP server, `packages/cli`
  the command-line tool — the two products are thin adapters over core.
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
npm run build     # build core, then mcp and cli
npm test          # unit suites for every package
npm run lint      # biome over the repo
```

The MCP server binary after a build: `node packages/mcp/dist/index.js` (or `npm start`).
The CLI binary after a build: `node packages/cli/dist/index.js`.

## License

[MIT](./LICENSE)
