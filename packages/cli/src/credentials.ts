/**
 * The stored-token credential store behind `labelgrid auth login`.
 *
 * macOS: the system Keychain via the `security` CLI (service `labelgrid-cli`,
 * account `token`) — the token never touches the filesystem.
 * Other platforms: `$XDG_CONFIG_HOME/labelgrid/credentials` (default
 * `~/.config/labelgrid/credentials`), written mode 0600 in a 0700 directory.
 *
 * The store NEVER prints or logs a token value; callers report only WHERE a
 * token was stored/cleared.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type TokenStore = {
  /** Persists the token. Returns a human description of where it went. */
  save(token: string): string;
  /** Returns the stored token, or null when none is stored/readable. */
  load(): string | null;
  /** Removes the stored token. Returns true when something was cleared. */
  clear(): boolean;
  /** Human description of the backing store (for status messages). */
  describe(): string;
};

const KEYCHAIN_SERVICE = 'labelgrid-cli';
const KEYCHAIN_ACCOUNT = 'token';

/** macOS Keychain store via the `security` CLI. */
export function keychainStore(): TokenStore {
  const run = (args: string[]): string =>
    execFileSync('security', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return {
    save(token: string): string {
      // -U updates an existing item in place instead of failing on a duplicate.
      run([
        'add-generic-password',
        '-U',
        '-s',
        KEYCHAIN_SERVICE,
        '-a',
        KEYCHAIN_ACCOUNT,
        '-w',
        token,
      ]);
      return this.describe();
    },
    load(): string | null {
      try {
        const out = run([
          'find-generic-password',
          '-s',
          KEYCHAIN_SERVICE,
          '-a',
          KEYCHAIN_ACCOUNT,
          '-w',
        ]).trim();
        return out.length > 0 ? out : null;
      } catch {
        return null;
      }
    },
    clear(): boolean {
      try {
        run(['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT]);
        return true;
      } catch {
        return false;
      }
    },
    describe(): string {
      return `macOS Keychain (service "${KEYCHAIN_SERVICE}")`;
    },
  };
}

/** Resolves the credentials file path for the non-macOS fallback store. */
export function credentialsFilePath(env: NodeJS.ProcessEnv): string {
  const configHome =
    env.XDG_CONFIG_HOME !== undefined && env.XDG_CONFIG_HOME.trim() !== ''
      ? env.XDG_CONFIG_HOME
      : join(homedir(), '.config');
  return join(configHome, 'labelgrid', 'credentials');
}

/** 0600-file fallback store used on non-macOS platforms. */
export function fileStore(filePath: string): TokenStore {
  return {
    save(token: string): string {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      writeFileSync(filePath, `${token}\n`, { mode: 0o600 });
      // writeFileSync's mode only applies on creation — enforce it on rewrite too.
      chmodSync(filePath, 0o600);
      return this.describe();
    },
    load(): string | null {
      try {
        const raw = readFileSync(filePath, 'utf8').trim();
        return raw.length > 0 ? raw : null;
      } catch {
        return null;
      }
    },
    clear(): boolean {
      try {
        unlinkSync(filePath);
        return true;
      } catch {
        return false;
      }
    },
    describe(): string {
      return filePath;
    },
  };
}

/** The platform-appropriate default store. */
export function defaultTokenStore(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): TokenStore {
  return platform === 'darwin' ? keychainStore() : fileStore(credentialsFilePath(env));
}
