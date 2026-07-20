/**
 * Sandbox contract smoke for the CLI.
 *
 * Runs only when BOTH LABELGRID_API_TOKEN and LABELGRID_API_URL are set (see
 * the contract workflow); skipped otherwise. The base URL and token come from
 * the environment ONLY — no hostname, token, or account name is committed
 * here, and there is deliberately no fallback to the production base URL.
 * Point them at the sandbox, never production.
 *
 * Drives the REAL command wiring (runCli) with the real @labelgrid/core
 * client. Only the output sinks and the credential store are substituted, so
 * a developer's keychain is never touched and no token can reach a terminal.
 */

import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/program.js';
import { Buf, memoryStore } from '../helpers.js';

const TOKEN = process.env.LABELGRID_API_TOKEN;
const BASE_URL = process.env.LABELGRID_API_URL;

async function runLive(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const stdout = new Buf();
  const stderr = new Buf();
  const code = await runCli(argv, {
    env: { LABELGRID_API_TOKEN: TOKEN, LABELGRID_API_URL: BASE_URL },
    stdout,
    stderr,
    tokenStore: memoryStore(),
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

describe.skipIf(!TOKEN || !BASE_URL)('CLI sandbox smoke', () => {
  it('auth whoami --json returns the authenticated account', async () => {
    const r = await runLive(['auth', 'whoami', '--json']);
    expect(r.code, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    // The account envelope carries an id (possibly nested under `data`).
    const id = parsed.id ?? (parsed.data as { id?: unknown } | undefined)?.id ?? parsed.account_id;
    expect(id).toBeDefined();
  });

  it('catalog search --type label --json returns a collection', async () => {
    const r = await runLive(['catalog', 'search', '--type', 'label', '--per-page', '5', '--json']);
    expect(r.code, r.stderr).toBe(0);
    const parsed = JSON.parse(r.stdout) as unknown;
    const rows = Array.isArray(parsed) ? parsed : (parsed as { data?: unknown[] } | null)?.data;
    expect(Array.isArray(rows)).toBe(true);
  });
});
