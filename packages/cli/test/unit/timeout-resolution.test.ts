import { describe, expect, it } from 'vitest';
import { run } from '../helpers.js';

const TOK = { LABELGRID_API_TOKEN: 'tok' };

describe('timeout resolution (--timeout / --transfer-timeout and env vars)', () => {
  it('leaves both timeouts undefined by default (the client default applies)', async () => {
    const r = await run(['auth', 'whoami'], { env: TOK });
    expect(r.code).toBe(0);
    expect(r.clientOpts[0].timeoutMs).toBeUndefined();
    expect(r.clientOpts[0].rawTimeoutMs).toBeUndefined();
  });

  it('reads the env vars', async () => {
    const r = await run(['auth', 'whoami'], {
      env: { ...TOK, LABELGRID_TIMEOUT_MS: '15000', LABELGRID_TRANSFER_TIMEOUT_MS: '120000' },
    });
    expect(r.clientOpts[0].timeoutMs).toBe(15000);
    expect(r.clientOpts[0].rawTimeoutMs).toBe(120000);
  });

  it('the flags win over the env vars', async () => {
    const r = await run(['auth', 'whoami', '--timeout', '5000', '--transfer-timeout', '60000'], {
      env: { ...TOK, LABELGRID_TIMEOUT_MS: '15000', LABELGRID_TRANSFER_TIMEOUT_MS: '120000' },
    });
    expect(r.clientOpts[0].timeoutMs).toBe(5000);
    expect(r.clientOpts[0].rawTimeoutMs).toBe(60000);
  });

  it('ignores a garbage flag value, warns once, and falls back to the default (undefined)', async () => {
    const r = await run(['auth', 'whoami', '--timeout', 'later'], { env: TOK });
    expect(r.code).toBe(0);
    expect(r.clientOpts[0].timeoutMs).toBeUndefined();
    expect(r.stderr).toContain('--timeout');
  });

  it('ignores a garbage env value and warns', async () => {
    const r = await run(['auth', 'whoami'], {
      env: { ...TOK, LABELGRID_TRANSFER_TIMEOUT_MS: '-1' },
    });
    expect(r.clientOpts[0].rawTimeoutMs).toBeUndefined();
    expect(r.stderr).toContain('LABELGRID_TRANSFER_TIMEOUT_MS');
  });
});
