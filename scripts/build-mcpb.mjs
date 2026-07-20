#!/usr/bin/env node
/**
 * Build the Claude Desktop one-click bundle (`labelgrid.mcpb`).
 *
 * Assembles a self-contained staging directory — the compiled server from
 * `packages/mcp/dist`, the package manifest, a production-only `node_modules`
 * (installed from the workspace lockfile with `--omit=dev`, with the
 * `@labelgrid/core` workspace link materialised as a real package), the
 * manifest and the licence — then runs `mcpb pack` over it. The result is a
 * single `.mcpb` an end user can double-click into Claude Desktop; it runs
 * offline against the bundled entry point, needing only Node.
 *
 * Run `npm run build` first (this script asserts both packages' `dist/`
 * exist). The manifest version is synced from `packages/mcp/package.json` so
 * the two never drift.
 *
 * Outputs (all gitignored): the staging dir `mcpb/build/`, the throwaway
 * dependency-install dir `mcpb/deps/`, and `labelgrid.mcpb`.
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mcpDir = join(root, 'packages', 'mcp');
const coreDir = join(root, 'packages', 'core');
const staging = join(root, 'mcpb', 'build');
const deps = join(root, 'mcpb', 'deps');
const output = join(root, 'labelgrid.mcpb');

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

const pkg = JSON.parse(readFileSync(join(mcpDir, 'package.json'), 'utf8'));

for (const [dir, name] of [
  [mcpDir, 'packages/mcp'],
  [coreDir, 'packages/core'],
]) {
  if (!existsSync(join(dir, 'dist', 'index.js'))) {
    console.error(`build-mcpb: ${name}/dist/index.js is missing — run \`npm run build\` first.`);
    process.exit(1);
  }
}

// Fresh staging directory.
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// The self-contained payload: compiled server, package manifest (version is
// the single source of truth for version.js at runtime), licence.
cpSync(join(mcpDir, 'dist'), join(staging, 'dist'), { recursive: true });
cpSync(join(mcpDir, 'package.json'), join(staging, 'package.json'));
cpSync(join(root, 'LICENSE'), join(staging, 'LICENSE'));

// Production dependencies only, resolved exactly from the workspace lockfile:
// `npm ci --omit=dev` runs against a package-manifest skeleton of the
// workspace in an isolated dir, so the staging tree never touches the real
// node_modules.
rmSync(deps, { recursive: true, force: true });
mkdirSync(join(deps, 'packages', 'core'), { recursive: true });
mkdirSync(join(deps, 'packages', 'mcp'), { recursive: true });
cpSync(join(root, 'package.json'), join(deps, 'package.json'));
cpSync(join(root, 'package-lock.json'), join(deps, 'package-lock.json'));
cpSync(join(coreDir, 'package.json'), join(deps, 'packages', 'core', 'package.json'));
cpSync(join(mcpDir, 'package.json'), join(deps, 'packages', 'mcp', 'package.json'));
run('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: deps });

// Copy the resolved modules, then materialise the `@labelgrid/*` workspace
// symlinks: the bundle must carry the real `@labelgrid/core` files, not links
// into a workspace that does not exist on the user's machine.
cpSync(join(deps, 'node_modules'), join(staging, 'node_modules'), {
  recursive: true,
  verbatimSymlinks: true,
});
rmSync(join(staging, 'node_modules', '@labelgrid'), { recursive: true, force: true });
const coreDest = join(staging, 'node_modules', '@labelgrid', 'core');
mkdirSync(coreDest, { recursive: true });
cpSync(join(coreDir, 'package.json'), join(coreDest, 'package.json'));
cpSync(join(coreDir, 'dist'), join(coreDest, 'dist'), { recursive: true });
rmSync(deps, { recursive: true, force: true });

// The manifest, with its version pinned to packages/mcp/package.json.
const manifest = JSON.parse(readFileSync(join(root, 'mcpb', 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Pack it. Pinned to the exact CLI version this build was validated with —
// this script also runs in CI with write access, so no floating versions.
run('npx', ['-y', '@anthropic-ai/mcpb@2.1.2', 'pack', staging, output]);

console.error(`\nbuild-mcpb: wrote ${output} (v${pkg.version}).`);
