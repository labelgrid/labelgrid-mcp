#!/usr/bin/env node
/**
 * API-coverage drift check.
 *
 * Compares the public API document (offline fixture by default, or a live URL)
 * against this server's coverage manifest (src/coverage.ts → dist/coverage.js).
 * It fails when the API grows an endpoint we neither expose as a tool nor
 * explicitly exclude — the signal to ship a tool (or an exclusion) in the same
 * cycle. It also flags manifest entries that no longer exist in the API
 * (stale coverage or stale exclusions).
 *
 * Sources:
 *   - Offline (default, used in CI): reads test/fixtures/openapi.json.
 *   - Live: set LABELGRID_OPENAPI_URL (defaults to the production API document
 *     when `--live` is passed) to fetch instead.
 *
 * Run: `node scripts/check-api-coverage.mjs [--live]`
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const DEFAULT_LIVE_URL = 'https://api.labelgrid.com/docs/api.json';
const FIXTURE = process.env.OPENAPI_FIXTURE ?? 'test/fixtures/openapi.json';

async function loadCoverage() {
  const distUrl = pathToFileURL(resolve('dist/coverage.js')).href;
  try {
    return await import(distUrl);
  } catch {
    console.error(
      'check-api-coverage: dist/coverage.js not found — run `npm run build` first (this check reads the compiled manifest).',
    );
    process.exit(1);
  }
}

async function loadSpec() {
  const live = process.argv.includes('--live') || process.env.LABELGRID_OPENAPI_URL;
  if (live) {
    const url = process.env.LABELGRID_OPENAPI_URL ?? DEFAULT_LIVE_URL;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.error(`check-api-coverage: fetch failed ${res.status} ${res.statusText} (${url})`);
      process.exit(1);
    }
    return res.json();
  }
  return JSON.parse(readFileSync(resolve(FIXTURE), 'utf8'));
}

function specEntries(spec) {
  const entries = [];
  for (const [path, ops] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(ops)) {
      if (HTTP_METHODS.has(method.toLowerCase())) {
        entries.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return entries;
}

async function main() {
  const { COVERAGE, EXCLUDED, PENDING_DOCS } = await loadCoverage();
  const spec = await loadSpec();
  const entries = specEntries(spec);
  const specSet = new Set(entries);

  const uncovered = entries.filter((e) => !(e in COVERAGE) && !(e in EXCLUDED));
  const staleCoverage = Object.keys(COVERAGE).filter(
    (e) => !specSet.has(e) && !(e in PENDING_DOCS),
  );
  const staleExclusions = Object.keys(EXCLUDED).filter((e) => !specSet.has(e));

  let failed = false;
  if (uncovered.length > 0) {
    failed = true;
    console.error('check-api-coverage: FAILED — public endpoints not covered by a tool:');
    for (const e of uncovered) {
      console.error(`  ${e}  — add a tool, or add it to EXCLUDED in src/coverage.ts`);
    }
  }
  if (staleCoverage.length > 0) {
    failed = true;
    console.error('check-api-coverage: FAILED — COVERAGE entries no longer in the API document:');
    for (const e of staleCoverage) {
      console.error(`  ${e}  — the endpoint changed or was removed; update src/coverage.ts`);
    }
  }
  if (staleExclusions.length > 0) {
    failed = true;
    console.error('check-api-coverage: FAILED — EXCLUDED entries no longer in the API document:');
    for (const e of staleExclusions) {
      console.error(`  ${e}  — remove the stale exclusion from src/coverage.ts`);
    }
  }

  if (failed) process.exit(1);

  console.error(
    `check-api-coverage: clean — ${entries.length} endpoints, ` +
      `${Object.keys(COVERAGE).length} covered, ${Object.keys(EXCLUDED).length} excluded.`,
  );
}

main().catch((err) => {
  console.error(`check-api-coverage: error — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
