/**
 * The package version, read from package.json at runtime so it stays the single
 * source of truth. Resolved relative to this module: `dist/version.js` → the
 * package-root `package.json` when built, `src/version.ts` → the same file in
 * tests.
 */

import { readFileSync } from 'node:fs';

function readVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VERSION: string = readVersion();
