#!/usr/bin/env node
/**
 * API-coverage drift check.
 *
 * Compares the public API document against this server's coverage manifest
 * (packages/mcp/src/coverage.ts → packages/mcp/dist/coverage.js).
 * It fails when the API grows an endpoint we neither expose as a tool nor
 * explicitly exclude — the signal to ship a tool (or an exclusion) in the same
 * cycle. It also flags manifest entries that no longer exist in the API
 * (stale coverage or stale exclusions).
 *
 * The document is resolved at RUN TIME and is never vendored into this
 * repository:
 *   - Default (and in CI): fetched from the production API document.
 *   - Override the URL with LABELGRID_OPENAPI_URL to check another environment.
 *   - OPENAPI_FIXTURE=<path> reads a local copy instead, for offline work. Keep
 *     any such copy OUT of the repository — `openapi.json` is gitignored.
 *
 * Run: `node scripts/check-api-coverage.mjs`
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const DEFAULT_URL = 'https://api.labelgrid.com/docs/api.json';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function loadCoverage() {
  const distUrl = pathToFileURL(resolve(REPO_ROOT, 'packages/mcp/dist/coverage.js')).href;
  try {
    return await import(distUrl);
  } catch {
    console.error(
      'check-api-coverage: packages/mcp/dist/coverage.js not found — run `npm run build` first (this check reads the compiled manifest).',
    );
    process.exit(1);
  }
}

async function loadSpec() {
  const localCopy = process.env.OPENAPI_FIXTURE;
  if (localCopy) {
    console.error(`check-api-coverage: reading the local API document at ${localCopy}.`);
    return JSON.parse(readFileSync(resolve(localCopy), 'utf8'));
  }
  const url = process.env.LABELGRID_OPENAPI_URL ?? DEFAULT_URL;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    console.error(`check-api-coverage: fetch failed ${res.status} ${res.statusText} (${url})`);
    process.exit(1);
  }
  return res.json();
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
      console.error(`  ${e}  — add a tool, or add it to EXCLUDED in packages/mcp/src/coverage.ts`);
    }
  }
  if (staleCoverage.length > 0) {
    failed = true;
    console.error('check-api-coverage: FAILED — COVERAGE entries no longer in the API document:');
    for (const e of staleCoverage) {
      console.error(
        `  ${e}  — the endpoint changed or was removed; update packages/mcp/src/coverage.ts`,
      );
    }
  }
  if (staleExclusions.length > 0) {
    failed = true;
    console.error('check-api-coverage: FAILED — EXCLUDED entries no longer in the API document:');
    for (const e of staleExclusions) {
      console.error(`  ${e}  — remove the stale exclusion from packages/mcp/src/coverage.ts`);
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
