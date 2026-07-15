#!/usr/bin/env node
/**
 * Generates the README tool-reference table from the compiled tool definitions,
 * so the docs never drift from the code. It reads every tool's name, title,
 * gate, toolset and description from `dist/`, renders one table per toolset, and
 * rewrites the region of README.md between the markers:
 *
 *   <!-- TOOLS:BEGIN -->
 *   ...generated...
 *   <!-- TOOLS:END -->
 *
 * Build first (`npm run build`) so `dist/` exists. Pass `--check` to verify the
 * README is up to date without writing (exit 1 on drift) — for CI.
 *
 * Run: `npm run gen-docs`
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BEGIN = '<!-- TOOLS:BEGIN -->';
const END = '<!-- TOOLS:END -->';

// Toolsets in the order they should appear in the docs.
const TOOLSET_ORDER = [
  'identity',
  'reference',
  'catalog',
  'releases',
  'review',
  'analytics',
  'accounting',
  'delivery',
  'webhooks',
  'distribution',
];

const TOOLSET_TITLES = {
  identity: 'Identity',
  reference: 'Reference data',
  catalog: 'Catalog (labels, artists, writers, publishers, releases, tracks, files)',
  releases: 'Releases & tracks (draft lifecycle)',
  review: 'Review & quality',
  analytics: 'Analytics',
  accounting: 'Accounting',
  delivery: 'Delivery',
  webhooks: 'Webhooks',
  distribution: 'Distribution (full writes)',
};

const GATE_LABEL = {
  read: 'read',
  safe_write: 'write',
  full_write: 'full-write',
};

const DIST_MODULES = [
  ['../dist/tools/identity.js', 'identityTools'],
  ['../dist/tools/reference.js', 'referenceTools'],
  ['../dist/tools/analytics.js', 'analyticsTools'],
  ['../dist/tools/catalog-read.js', 'catalogReadTools'],
  ['../dist/tools/files-read.js', 'filesReadTools'],
  ['../dist/tools/review-read.js', 'reviewReadTools'],
  ['../dist/tools/delivery.js', 'deliveryTools'],
  ['../dist/tools/accounting.js', 'accountingTools'],
  ['../dist/tools/webhooks.js', 'webhookTools'],
  ['../dist/tools/catalog-write.js', 'catalogWriteTools'],
  ['../dist/tools/release-write.js', 'releaseWriteTools'],
  ['../dist/tools/full-writes.js', 'fullWriteTools'],
];

async function loadTools() {
  const all = [];
  for (const [rel, exportName] of DIST_MODULES) {
    const url = pathToFileURL(resolve(new URL('.', import.meta.url).pathname, rel)).href;
    let mod;
    try {
      mod = await import(url);
    } catch {
      console.error(
        `gen-tool-docs: could not import ${rel} — run \`npm run build\` first (the generator reads compiled tools).`,
      );
      process.exit(1);
    }
    all.push(...mod[exportName]);
  }
  return all;
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function render(tools) {
  const byToolset = new Map();
  for (const t of tools) {
    if (!byToolset.has(t.toolset)) byToolset.set(t.toolset, []);
    byToolset.get(t.toolset).push(t);
  }
  const lines = [];
  const total = tools.length;
  lines.push(`_${total} tools across ${byToolset.size} toolsets. This table is generated from the`);
  lines.push('tool definitions by `npm run gen-docs` — do not edit it by hand._');
  lines.push('');
  const seen = new Set();
  const order = [...TOOLSET_ORDER.filter((t) => byToolset.has(t)), ...byToolset.keys()];
  for (const toolset of order) {
    if (seen.has(toolset)) continue;
    seen.add(toolset);
    const group = byToolset.get(toolset);
    if (!group) continue;
    lines.push(`### ${TOOLSET_TITLES[toolset] ?? toolset} \`${toolset}\``);
    lines.push('');
    lines.push('| Tool | Gate | Description |');
    lines.push('| --- | --- | --- |');
    for (const t of group) {
      lines.push(
        `| \`${t.name}\` | ${GATE_LABEL[t.gate] ?? t.gate} | ${escapeCell(t.description)} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

async function main() {
  const readmePath = resolve('README.md');
  let readme;
  try {
    readme = readFileSync(readmePath, 'utf8');
  } catch {
    console.error('gen-tool-docs: README.md not found.');
    process.exit(1);
  }
  const begin = readme.indexOf(BEGIN);
  const end = readme.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    console.error(`gen-tool-docs: could not find the ${BEGIN} / ${END} markers in README.md.`);
    process.exit(1);
  }

  // The `setup` helper is a mode, not part of the tool catalog — never document
  // it in the reference table (it would misstate the tool count).
  const tools = (await loadTools()).filter((t) => t.toolset !== 'setup');
  const table = render(tools);
  const next = `${readme.slice(0, begin + BEGIN.length)}\n\n${table}\n\n${readme.slice(end)}`;

  if (process.argv.includes('--check')) {
    if (next !== readme) {
      console.error('gen-tool-docs: README tool table is out of date — run `npm run gen-docs`.');
      process.exit(1);
    }
    console.error('gen-tool-docs: README tool table is up to date.');
    return;
  }

  writeFileSync(readmePath, next);
  console.error(`gen-tool-docs: wrote ${tools.length} tools into README.md.`);
}

main().catch((err) => {
  console.error(`gen-tool-docs: error — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
