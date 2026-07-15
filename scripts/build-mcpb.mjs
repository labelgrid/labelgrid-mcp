#!/usr/bin/env node
/**
 * Build the Claude Desktop one-click bundle (`labelgrid.mcpb`).
 *
 * Assembles a self-contained staging directory — the compiled `dist/`, the
 * package manifest, the production-only `node_modules` (installed from the
 * lockfile with `--omit=dev`), the manifest and the licence — then runs
 * `mcpb pack` over it. The result is a single `.mcpb` an end user can
 * double-click into Claude Desktop; it runs offline against the bundled entry
 * point, needing only Node.
 *
 * Run `npm run build` first (this script asserts `dist/` exists). The manifest
 * version is synced from `package.json` so the two never drift.
 *
 * Outputs (both gitignored): the staging dir `mcpb/build/` and `labelgrid.mcpb`.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staging = join(root, 'mcpb', 'build');
const output = join(root, 'labelgrid.mcpb');

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

if (!existsSync(join(root, 'dist', 'index.js'))) {
  console.error('build-mcpb: dist/index.js is missing — run `npm run build` first.');
  process.exit(1);
}

// Fresh staging directory.
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// The self-contained payload: compiled server, package manifest (version is the
// single source of truth for version.js at runtime), lockfile, licence.
cpSync(join(root, 'dist'), join(staging, 'dist'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', 'LICENSE']) {
  cpSync(join(root, file), join(staging, file));
}

// Production dependencies only, resolved exactly from the lockfile.
run('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: staging });

// The manifest, with its version pinned to package.json.
const manifest = JSON.parse(readFileSync(join(root, 'mcpb', 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Pack it. Pinned to the exact CLI version this build was validated with —
// this script also runs in CI with write access, so no floating versions.
run('npx', ['-y', '@anthropic-ai/mcpb@2.1.2', 'pack', staging, output]);

console.error(`\nbuild-mcpb: wrote ${output} (v${pkg.version}).`);
