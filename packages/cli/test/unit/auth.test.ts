import { describe, expect, it } from 'vitest';
import { memoryStore, run } from '../helpers.js';

describe('auth login/logout', () => {
  it('login --token stores the token without echoing its value', async () => {
    const store = memoryStore();
    const r = await run(['auth', 'login', '--token', 'secret-tok-9'], { env: {}, store });
    expect(r.code).toBe(0);
    expect(store.token).toBe('secret-tok-9');
    expect(r.stdout).toContain('memory store');
    expect(r.stdout).not.toContain('secret-tok-9');
    expect(r.stderr).not.toContain('secret-tok-9');
    expect(r.calls).toHaveLength(0); // purely local
  });

  it('login without --token reads the token from the input line', async () => {
    const store = memoryStore();
    const r = await run(['auth', 'login'], { env: {}, store, answer: '  piped-tok  ' });
    expect(r.code).toBe(0);
    expect(store.token).toBe('piped-tok');
    expect(r.stdout).not.toContain('piped-tok');
  });

  it('login on a TTY reads the token with echo disabled and never echoes it', async () => {
    const store = memoryStore();
    let readSecretCalled = false;
    const r = await run(['auth', 'login'], {
      env: {},
      store,
      stdinIsTTY: true,
      readSecret: async () => {
        readSecretCalled = true;
        return '  hidden-tok  ';
      },
    });
    expect(r.code).toBe(0);
    // The hidden reader (echo-mute seam), not the plain line reader, was used.
    expect(readSecretCalled).toBe(true);
    expect(store.token).toBe('hidden-tok');
    // The prompt announces hidden entry, and the token never reaches any stream.
    expect(r.stderr).toContain('input hidden');
    expect(r.stdout).not.toContain('hidden-tok');
    expect(r.stderr).not.toContain('hidden-tok');
    expect(r.calls).toHaveLength(0); // purely local
  });

  it('login with an empty input fails with NO_TOKEN', async () => {
    const store = memoryStore();
    const r = await run(['auth', 'login'], { env: {}, store, answer: '' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('NO_TOKEN');
    expect(store.token).toBeNull();
  });

  it('logout clears the stored token', async () => {
    const store = memoryStore('old-tok');
    const r = await run(['auth', 'logout'], { env: {}, store });
    expect(r.code).toBe(0);
    expect(store.token).toBeNull();
    expect(r.stdout).toContain('Removed');
  });

  it('logout with nothing stored reports so and still exits 0', async () => {
    const r = await run(['auth', 'logout'], { env: {}, store: memoryStore(null) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('No stored token');
  });
});

describe('auth whoami / token-revoke', () => {
  it('whoami routes to GET /me', async () => {
    const r = await run(['auth', 'whoami']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'get', args: ['/me', undefined] }]);
  });

  it('token-revoke --yes revokes the current token', async () => {
    const r = await run(['auth', 'token-revoke', '--yes']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'delete', args: ['/tokens/current'] }]);
  });

  it('token-revoke --token-id targets that token id', async () => {
    const r = await run(['auth', 'token-revoke', '--token-id', '42', '--yes']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'delete', args: ['/tokens/42'] }]);
  });

  it('token-revoke without --yes and no confirmation aborts before any call', async () => {
    const r = await run(['auth', 'token-revoke'], { answer: '' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Type y to confirm');
    expect(r.stderr).toContain('Aborted');
    expect(r.calls).toHaveLength(0);
  });

  it('token-revoke proceeds on a typed y', async () => {
    const r = await run(['auth', 'token-revoke'], { answer: 'y' });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'delete', args: ['/tokens/current'] }]);
  });
});
