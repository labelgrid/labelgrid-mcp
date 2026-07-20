import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URL } from '../../src/context.js';
import { memoryStore, run } from '../helpers.js';

describe('token resolution order (env > stored > --token)', () => {
  it('the environment token wins over a stored token and the --token flag', async () => {
    const r = await run(['auth', 'whoami', '--token', 'flag-tok'], {
      env: { LABELGRID_API_TOKEN: 'env-tok' },
      store: memoryStore('stored-tok'),
    });
    expect(r.code).toBe(0);
    expect(r.clientOpts).toHaveLength(1);
    expect(r.clientOpts[0].token).toBe('env-tok');
  });

  it('a stored token wins over the --token flag when no env token is set', async () => {
    const r = await run(['auth', 'whoami', '--token', 'flag-tok'], {
      env: {},
      store: memoryStore('stored-tok'),
    });
    expect(r.code).toBe(0);
    expect(r.clientOpts[0].token).toBe('stored-tok');
  });

  it('the --token flag is used when neither env nor store has a token', async () => {
    const r = await run(['auth', 'whoami', '--token', 'flag-tok'], {
      env: {},
      store: memoryStore(null),
    });
    expect(r.code).toBe(0);
    expect(r.clientOpts[0].token).toBe('flag-tok');
  });

  it('no token anywhere → structured NO_TOKEN error, exit 1, no client built', async () => {
    const r = await run(['auth', 'whoami'], { env: {}, store: memoryStore(null) });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('NO_TOKEN');
    expect(r.clientOpts).toHaveLength(0);
    expect(r.calls).toHaveLength(0);
  });

  it('a whitespace-only env token is ignored', async () => {
    const r = await run(['auth', 'whoami'], {
      env: { LABELGRID_API_TOKEN: '   ' },
      store: memoryStore('stored-tok'),
    });
    expect(r.code).toBe(0);
    expect(r.clientOpts[0].token).toBe('stored-tok');
  });
});

describe('API base URL resolution', () => {
  it('defaults to the production public API', async () => {
    const r = await run(['auth', 'whoami']);
    expect(r.clientOpts[0].baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it('LABELGRID_API_URL overrides the default', async () => {
    const r = await run(['auth', 'whoami'], {
      env: { LABELGRID_API_TOKEN: 't', LABELGRID_API_URL: 'https://alt.example.test/api' },
    });
    expect(r.clientOpts[0].baseUrl).toBe('https://alt.example.test/api');
  });

  it('--api-url beats the environment', async () => {
    const r = await run(['auth', 'whoami', '--api-url', 'https://flag.example.test/api'], {
      env: { LABELGRID_API_TOKEN: 't', LABELGRID_API_URL: 'https://alt.example.test/api' },
    });
    expect(r.clientOpts[0].baseUrl).toBe('https://flag.example.test/api');
  });
});
