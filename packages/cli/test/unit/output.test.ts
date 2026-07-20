import { describe, expect, it } from 'vitest';
import { VERSION } from '../../src/version.js';
import { TEST_TOKEN, makeStubClient, run } from '../helpers.js';

describe('exit codes', () => {
  it('success is 0', async () => {
    expect((await run(['auth', 'whoami'])).code).toBe(0);
  });

  it('an API error is 1', async () => {
    const r = await run(['auth', 'whoami'], {
      clientCfg: { result: { error: { code: 'NOT_FOUND', message: 'nope', status: 404 } } },
    });
    expect(r.code).toBe(1);
  });

  it('an unknown command is a usage error (2)', async () => {
    expect((await run(['frobnicate'])).code).toBe(2);
  });

  it('a missing required option is a usage error (2)', async () => {
    expect((await run(['catalog', 'search'])).code).toBe(2);
  });

  it('--version prints the package version and exits 0', async () => {
    const r = await run(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(VERSION);
  });

  it('--help exits 0', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('labelgrid');
  });
});

describe('output modes', () => {
  const payload = {
    data: [
      { id: 1, name: 'Alpha', status: 'live' },
      { id: 2, name: 'Beta', status: 'draft' },
    ],
    meta: { total: 2 },
  };

  it('--json prints the raw API response to stdout', async () => {
    const r = await run(['webhook', 'list', '--json'], {
      clientCfg: { result: { data: payload } },
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(payload);
  });

  it('global flags also work before the subcommand', async () => {
    const r = await run(['--json', 'webhook', 'list'], {
      clientCfg: { result: { data: payload } },
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(payload);
  });

  it('the default human view renders a table for list payloads', async () => {
    const r = await run(['webhook', 'list'], { clientCfg: { result: { data: payload } } });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('id');
    expect(r.stdout).toContain('name');
    expect(r.stdout).toContain('Alpha');
    expect(r.stdout).toContain('Beta');
    expect(r.stdout).toContain('total=2');
  });

  it('an error prints one line `code: message` to stderr', async () => {
    const r = await run(['auth', 'whoami'], {
      clientCfg: {
        result: { error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded.', status: 429 } },
      },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('RATE_LIMITED: Rate limit exceeded.');
    expect(r.stdout).toBe('');
  });

  it('an error under --json also emits the error JSON on stdout', async () => {
    const r = await run(['auth', 'whoami', '--json'], {
      clientCfg: {
        result: { error: { code: 'FORBIDDEN', message: 'Forbidden.', status: 403 } },
      },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('FORBIDDEN: Forbidden.');
    expect(JSON.parse(r.stdout)).toEqual({
      error: { code: 'FORBIDDEN', message: 'Forbidden.', status: 403 },
    });
  });
});

describe('token redaction', () => {
  it('a token echoed in an API error message never reaches stdout/stderr', async () => {
    const r = await run(['auth', 'whoami', '--json'], {
      clientCfg: {
        result: {
          error: {
            code: 'TOKEN_INVALID',
            message: `The token ${TEST_TOKEN} was rejected.`,
            status: 401,
          },
        },
      },
    });
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain(TEST_TOKEN);
    expect(r.stderr).not.toContain(TEST_TOKEN);
    expect(r.stderr).toContain('***REDACTED***');
  });

  it('a token echoed in a success payload is scrubbed from both output modes', async () => {
    const stub = makeStubClient({ result: { data: { echoed: TEST_TOKEN, ok: true } } });
    const json = await run(['auth', 'whoami', '--json'], { stub });
    expect(json.stdout).not.toContain(TEST_TOKEN);
    expect(json.stdout).toContain('***REDACTED***');

    const human = await run(['auth', 'whoami'], { stub });
    expect(human.stdout).not.toContain(TEST_TOKEN);
    expect(human.stdout).toContain('***REDACTED***');
  });
});

describe('unexpected-error output is scrubbed', () => {
  it('redacts the resolved token from an unexpected error message', async () => {
    const r = await run(['auth', 'whoami'], {
      env: { LABELGRID_API_TOKEN: TEST_TOKEN },
      createClient: () => {
        throw new Error(`connection to ${TEST_TOKEN} refused`);
      },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('UNEXPECTED_ERROR:');
    expect(r.stderr).toContain('[redacted]');
    expect(r.stderr).not.toContain(TEST_TOKEN);
  });

  it('keeps only the sanitized first line of a child-process-style error', async () => {
    const r = await run(['auth', 'whoami'], {
      env: { LABELGRID_API_TOKEN: TEST_TOKEN },
      createClient: () => {
        throw new Error(
          `Command failed: security add-generic-password -w ${TEST_TOKEN}\nextra stderr line`,
        );
      },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('UNEXPECTED_ERROR: Command failed: security');
    // The argv (with the token) and trailing stderr are dropped.
    expect(r.stderr).not.toContain('add-generic-password');
    expect(r.stderr).not.toContain('extra stderr line');
    expect(r.stderr).not.toContain(TEST_TOKEN);
  });

  it('leaves a structured API error unchanged (no [redacted] mask)', async () => {
    const r = await run(['auth', 'whoami'], {
      clientCfg: {
        result: { error: { code: 'NOT_FOUND', message: 'nope', status: 404 } },
      },
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('NOT_FOUND: nope');
    expect(r.stderr).not.toContain('[redacted]');
    expect(r.stderr).not.toContain('UNEXPECTED_ERROR');
  });
});
