import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialsFilePath, defaultTokenStore, fileStore } from '../../src/credentials.js';

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
