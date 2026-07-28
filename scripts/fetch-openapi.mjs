#!/usr/bin/env node
/**
 * One-shot helper: fetch the public OpenAPI document to a LOCAL, gitignored
 * path (tmp/openapi.json) for use as a tool-schema reference while working.
 *
 * The document is NEVER vendored into this repository — `tmp/` and any
 * `openapi.json` are gitignored, and the API-coverage drift check fetches the
 * document at run time rather than reading a committed copy. Override the
 * destination with OPENAPI_OUT and the source with LABELGRID_OPENAPI_URL; keep
 * any destination you choose outside version control.
 *
 * Run: `node scripts/fetch-openapi.mjs`
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const url = process.env.LABELGRID_OPENAPI_URL ?? 'https://api.labelgrid.com/docs/api.json';
const out = resolve(process.env.OPENAPI_OUT ?? resolve(repoRoot, 'tmp/openapi.json'));

const res = await fetch(url, { headers: { Accept: 'application/json' } });
if (!res.ok) {
  console.error(`Fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const spec = await res.json();
const pathCount = spec.paths ? Object.keys(spec.paths).length : 0;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(spec, null, 2)}\n`);
console.error(`Wrote ${out} — ${pathCount} paths, OpenAPI ${spec.openapi ?? '?'}`);
