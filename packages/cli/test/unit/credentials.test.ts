import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type SecurityRunner,
  credentialsFilePath,
  defaultTokenStore,
  escapeSecurityArg,
  fileStore,
  keychainStore,
} from '../../src/credentials.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lg-cli-creds-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('fileStore (non-macOS fallback)', () => {
  it('saves the token 0600 in a 0700 directory and loads it back', () => {
    const path = join(dir, 'nested', 'credentials');
    const store = fileStore(path);
    expect(store.load()).toBeNull();
    store.save('file-tok-1');
    expect(store.load()).toBe('file-tok-1');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700);
  });

  it('re-saving replaces the token and keeps 0600', () => {
    const path = join(dir, 'rewrite', 'credentials');
    const store = fileStore(path);
    store.save('first');
    store.save('second');
    expect(store.load()).toBe('second');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('clear removes the file and reports whether anything was cleared', () => {
    const path = join(dir, 'clear', 'credentials');
    const store = fileStore(path);
    store.save('tok');
    expect(store.clear()).toBe(true);
    expect(store.load()).toBeNull();
    expect(store.clear()).toBe(false);
  });
});

describe('store selection', () => {
  it('non-darwin platforms use the credentials file (XDG-aware)', () => {
    const env = { XDG_CONFIG_HOME: join(dir, 'xdg') };
    expect(credentialsFilePath(env)).toBe(join(dir, 'xdg', 'labelgrid', 'credentials'));
    const store = defaultTokenStore(env, 'linux');
    expect(store.describe()).toBe(join(dir, 'xdg', 'labelgrid', 'credentials'));
  });

  it('darwin uses the Keychain-backed store', () => {
    const store = defaultTokenStore({}, 'darwin');
    expect(store.describe()).toContain('Keychain');
  });
});

describe('keychainStore — token never passes through argv', () => {
  type Feed = { args: string[]; stdin: string };

  function stubRunner(feedResult: { status: number | null; error?: Error }): {
    runner: SecurityRunner;
    feeds: Feed[];
  } {
    const feeds: Feed[] = [];
    const runner: SecurityRunner = {
      capture: () => '',
      feed: (args, stdin) => {
        feeds.push({ args, stdin });
        return feedResult;
      },
    };
    return { runner, feeds };
  }

  it('writes the token via `security -i` STDIN, not as an argument', () => {
    const { runner, feeds } = stubRunner({ status: 0 });
    const token = 'tok-abc-123'; // word-safe: escaped form equals the raw token
    keychainStore(runner).save(token);

    expect(feeds).toHaveLength(1);
    const feed = feeds[0];
    // Interactive mode only — no add-generic-password / token in the argv.
    expect(feed.args).toEqual(['-i']);
    expect(feed.args.join(' ')).not.toContain(token);
    // The command (with the token) is delivered over stdin.
    expect(feed.stdin).toContain('add-generic-password -U -s labelgrid-cli -a token -w ');
    expect(feed.stdin).toContain(token);
  });

  it('single-argument-escapes a token with special characters for the stdin command', () => {
    const { runner, feeds } = stubRunner({ status: 0 });
    const token = 'ab\'cd ef$gh"ij'; // quote, space, dollar, double-quote
    keychainStore(runner).save(token);

    const feed = feeds[0];
    expect(feed.args).toEqual(['-i']);
    // The escaped form (never the raw token) appears in the stdin payload.
    expect(feed.stdin).toContain(`-w ${escapeSecurityArg(token)}`);
    expect(feed.stdin).not.toContain(`-w ${token}`);
    // And the raw token is never in the args array.
    expect(feed.args.join(' ')).not.toContain(token);
  });

  it('a failing child produces an error that does NOT contain the token', () => {
    const secret = 'super-secret-token-value';
    const { runner } = stubRunner({ status: 1 });
    expect(() => keychainStore(runner).save(secret)).toThrow(/Keychain write failed/);
    try {
      keychainStore(runner).save(secret);
      expect.unreachable('save should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });

  it('a spawn error also produces a token-free error', () => {
    const secret = 'another-secret-token';
    const runner: SecurityRunner = {
      capture: () => '',
      feed: () => ({ status: null, error: new Error(`spawn failed for ${secret}`) }),
    };
    try {
      keychainStore(runner).save(secret);
      expect.unreachable('save should have thrown');
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});
