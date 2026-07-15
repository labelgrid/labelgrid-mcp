#!/usr/bin/env node
/**
 * One-shot helper: fetch the public OpenAPI document and write it to
 * test/fixtures/openapi.json for use as the tool-schema reference and by the
 * API-coverage drift check.
 *
 * The document is the public, customer-facing API spec. The base defaults to
 * production; override with LABELGRID_OPENAPI_URL for another environment.
 * Run: `node scripts/fetch-openapi.mjs`
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const url = process.env.LABELGRID_OPENAPI_URL ?? 'https://api.labelgrid.com/docs/api.json';
const out = resolve(process.env.OPENAPI_OUT ?? 'test/fixtures/openapi.json');

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
