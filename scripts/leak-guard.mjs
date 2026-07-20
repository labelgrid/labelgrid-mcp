#!/usr/bin/env node
/**
 * Repository hygiene scan.
 *
 * This is a PUBLIC, open-source repository. This scanner walks the committed
 * tree and fails (exit 1) on a small set of neutral hygiene red flags, so they
 * are caught before they ship. It flags:
 *   - secret-like literals: private-key PEM headers, bearer tokens, long hex
 *     digests, and `sk-` style API keys,
 *   - issue-tracker references,
 *   - non-production (staging) hostnames.
 *
 * It prints a file:line report for each hit so it can be fixed before commit.
 *
 * Legitimate exceptions:
 *   - The generated API-document fixture is skipped (it is the upstream spec).
 *   - Any single line may carry an inline `leak-guard-allow: <term>` pragma to
 *     whitelist a specific, justified occurrence on that line.
 *
 * Run: `node scripts/leak-guard.mjs [root]`
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// The hygiene checks — one array, each entry a matcher with a neutral name.
export const BANNED = [
  // Secret-like literals.
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/ },
  { name: 'long-hex-secret', re: /\b[0-9a-f]{40,}\b/i },
  { name: 'api-key-literal', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  // Issue-tracker references.
  { name: 'ticket-ref', re: /\b[A-Z]{2,5}-[0-9]{3,}\b/ },
  // Non-production hostnames (any labelgrid.com subdomain with a non-prod marker).
  {
    name: 'non-production-host',
    re: /\b[a-z0-9.-]*(stg|staging|sandbox|dev)[a-z0-9.-]*\.labelgrid\.com\b/i,
  },
  // Absolute developer paths.
  { name: 'developer-path', re: /\/Users\/[a-z]+\// },
];

// Directory/file paths (relative to root, posix-style) never scanned.
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'tmp']);
const SKIP_FILES = new Set(['packages/mcp/test/fixtures/openapi.json']);
// Uncommitted local helpers (gitignored) — e.g. scripts/*.local.mjs — are
// outside this guard's remit.
const LOCAL_FILE_RE = /\.local\.[cm]?[jt]s$/;

// Extensions/roots that ARE scanned. `packages` covers every workspace's
// sources, tests, manifests and docs; `skills` covers the public agent skills.
const SCAN_DIRS = ['packages', 'scripts', 'skills'];
const ROOT_FILE_RE = /\.(md|json)$/i; // root-level *.md + *.json manifests

function extractAllowed(line) {
  const allowed = [];
  const re = /leak-guard-allow:\s*(\S+)/gi;
  let m = re.exec(line);
  while (m !== null) {
    allowed.push(m[1].toLowerCase());
    m = re.exec(line);
  }
  return allowed;
}

/** Scans one file's content, returning an array of {file, line, name, text} hits. */
export function scanContent(relPath, content) {
  const hits = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const allowed = extractAllowed(line);
    for (const { name, re } of BANNED) {
      const match = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      let m = match.exec(line);
      while (m !== null) {
        const text = m[0];
        const isAllowed = allowed.some(
          (a) => text.toLowerCase().includes(a) || a.includes(text.toLowerCase()),
        );
        if (!isAllowed) hits.push({ file: relPath, line: i + 1, name, text });
        m = match.exec(line);
      }
    }
  }
  return hits;
}

function isSkippedFile(rel) {
  return SKIP_FILES.has(rel) || LOCAL_FILE_RE.test(rel);
}

function collectFiles(root) {
  const out = [];
  // The configured scan directories, recursively.
  for (const dir of SCAN_DIRS) {
    const abs = join(root, dir);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(root, abs, out);
  }
  // Root-level *.md and *.json (e.g. README.md, server.json).
  for (const entry of readdirSync(root)) {
    if (!ROOT_FILE_RE.test(entry)) continue;
    const rel = entry;
    if (isSkippedFile(rel) || SKIP_DIRS.has(entry)) continue;
    try {
      if (statSync(join(root, entry)).isFile()) out.push(join(root, entry));
    } catch {
      /* ignore */
    }
  }
  return out;
}

function walk(root, dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    const rel = relative(root, abs).split('\\').join('/');
    if (isSkippedFile(rel)) continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(root, abs, out);
    else out.push(abs);
  }
}

/** Walks the tree under `root`, returning all hits. */
export function scanTree(root) {
  const hits = [];
  for (const abs of collectFiles(root)) {
    const rel = relative(root, abs).split('\\').join('/');
    if (isSkippedFile(rel)) continue;
    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    hits.push(...scanContent(rel, content));
  }
  return hits;
}

function main() {
  const root = resolve(process.argv[2] ?? '.');
  const hits = scanTree(root);
  if (hits.length === 0) {
    console.error('leak-guard: clean — no hygiene red flags found.');
    process.exit(0);
  }
  console.error(`leak-guard: FAILED — ${hits.length} hygiene red flag(s) found:`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  [${h.name}] "${h.text}"`);
  }
  console.error(
    '\nRemove the secret, ticket reference, or non-production host, or add an inline `leak-guard-allow: <term>` pragma if the use is legitimate.',
  );
  process.exit(1);
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main();
}
