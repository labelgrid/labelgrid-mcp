/**
 * Per-invocation context: global-flag parsing, token resolution, and the core
 * client. Every dependency with a side effect (client construction, credential
 * store, streams, confirmation input) is injectable so unit tests run the real
 * command wiring against stubs with no live network.
 *
 * Token resolution order (the documented contract):
 *   1. LABELGRID_API_TOKEN environment variable
 *   2. the token stored by `labelgrid auth login`
 *   3. the --token flag (for CI)
 */

import { LabelGridClient, parseTimeoutMs } from '@labelgrid/core';
import type { TokenStore } from './credentials.js';
import { defaultTokenStore } from './credentials.js';
import { CliError } from './errors.js';
import type { Output, Sink } from './output.js';
import { printApiError } from './output.js';
import { defaultReadSecret } from './secret-input.js';
import { VERSION } from './version.js';

export const DEFAULT_BASE_URL = 'https://api.labelgrid.com/api/public';

/**
 * The structural subset of {@link LabelGridClient} the commands use. A Pick of
 * the class keeps only the public methods, so a plain-object test stub is
 * assignable.
 */
export type CliClient = Pick<
  LabelGridClient,
  'get' | 'post' | 'patch' | 'put' | 'delete' | 'postMultipart' | 'raw' | 'getRaw'
>;

export type ClientOpts = {
  baseUrl: string;
  token: string;
  /** JSON request timeout override (ms); undefined uses the client default. */
  timeoutMs?: number;
  /** Raw transfer timeout override (ms); undefined uses the client default. */
  rawTimeoutMs?: number;
};

export type CliDeps = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  stdout?: Sink;
  stderr?: Sink;
  tokenStore?: TokenStore;
  createClient?: (opts: ClientOpts) => CliClient;
  /** Reads one line of confirmation input (defaults to stdin). */
  readLine?: () => Promise<string>;
  /** True when stdin is an interactive terminal (enables hidden token entry). */
  stdinIsTTY?: boolean;
  /** Reads the login token with terminal echo disabled (defaults to raw stdin). */
  readSecret?: () => Promise<string>;
};

/** The global flags commander collects on the root command. */
export type GlobalOpts = {
  json?: boolean;
  token?: string;
  apiUrl?: string;
  yes?: boolean;
  timeout?: string;
  transferTimeout?: string;
};

export type Resolved = {
  env: NodeJS.ProcessEnv;
  stdout: Sink;
  stderr: Sink;
  tokenStore: TokenStore;
  createClient: (opts: ClientOpts) => CliClient;
  readLine: () => Promise<string>;
  stdinIsTTY: boolean;
  readSecret: () => Promise<string>;
};

function defaultReadLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let buffer = '';
    const finish = (): void => {
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.pause();
      resolve(buffer);
    };
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl !== -1) {
        buffer = buffer.slice(0, nl);
        finish();
      }
    };
    const onEnd = (): void => finish();
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.resume();
  });
}

/** Fills every optional dependency with its real default. */
export function resolveDeps(deps: CliDeps): Resolved {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  return {
    env,
    stdout: deps.stdout ?? process.stdout,
    stderr: deps.stderr ?? process.stderr,
    tokenStore: deps.tokenStore ?? defaultTokenStore(env, platform),
    createClient:
      deps.createClient ??
      ((opts: ClientOpts): CliClient =>
        new LabelGridClient({
          baseUrl: opts.baseUrl,
          token: opts.token,
          version: VERSION,
          userAgent: `labelgrid-cli/${VERSION}`,
          timeoutMs: opts.timeoutMs,
          rawTimeoutMs: opts.rawTimeoutMs,
        })),
    readLine: deps.readLine ?? defaultReadLine,
    stdinIsTTY: deps.stdinIsTTY ?? process.stdin.isTTY === true,
    readSecret: deps.readSecret ?? defaultReadSecret,
  };
}

export type TokenResolution = { token: string; source: 'env' | 'stored' | 'flag' } | null;

/** Applies the env > stored > --token resolution order. */
export function resolveToken(
  env: NodeJS.ProcessEnv,
  store: TokenStore,
  flagToken: string | undefined,
): TokenResolution {
  const fromEnv = env.LABELGRID_API_TOKEN?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return { token: fromEnv, source: 'env' };
  const stored = store.load();
  if (stored !== null) return { token: stored, source: 'stored' };
  if (flagToken !== undefined && flagToken.trim().length > 0) {
    return { token: flagToken.trim(), source: 'flag' };
  }
  return null;
}

/**
 * Resolves one timeout: the flag wins over the env var; a non-positive-integer
 * value (from either source) is ignored — the client default applies — and a
 * single warning is written to stderr.
 */
function resolveOneTimeout(
  flagValue: string | undefined,
  flagName: string,
  envValue: string | undefined,
  envName: string,
  stderr: Sink,
): number | undefined {
  const fromFlag = parseTimeoutMs(flagValue);
  if (fromFlag.invalid) {
    stderr.write(
      `${flagName} must be a positive integer of milliseconds; ignoring "${flagValue}".\n`,
    );
  } else if (fromFlag.value !== undefined) {
    return fromFlag.value;
  }
  const fromEnv = parseTimeoutMs(envValue);
  if (fromEnv.invalid) {
    stderr.write(
      `${envName} must be a positive integer of milliseconds; ignoring "${envValue}".\n`,
    );
  }
  return fromEnv.value;
}

/** Resolves both timeouts from the global flags and their env vars. */
export function resolveTimeouts(
  env: NodeJS.ProcessEnv,
  globals: GlobalOpts,
  stderr: Sink,
): { timeoutMs: number | undefined; rawTimeoutMs: number | undefined } {
  return {
    timeoutMs: resolveOneTimeout(
      globals.timeout,
      '--timeout',
      env.LABELGRID_TIMEOUT_MS,
      'LABELGRID_TIMEOUT_MS',
      stderr,
    ),
    rawTimeoutMs: resolveOneTimeout(
      globals.transferTimeout,
      '--transfer-timeout',
      env.LABELGRID_TRANSFER_TIMEOUT_MS,
      'LABELGRID_TRANSFER_TIMEOUT_MS',
      stderr,
    ),
  };
}

/** Resolves the API base URL: --api-url flag > LABELGRID_API_URL env > default. */
export function resolveBaseUrl(env: NodeJS.ProcessEnv, flagUrl: string | undefined): string {
  if (flagUrl !== undefined && flagUrl.trim().length > 0) return flagUrl.trim();
  const fromEnv = env.LABELGRID_API_URL?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return DEFAULT_BASE_URL;
}

export type CommandContext = {
  client: CliClient;
  out: Output;
  yes: boolean;
  baseUrl: string;
  token: string;
  readLine: () => Promise<string>;
};

/** Builds the output sink for commands that never need a client (auth login…). */
export function buildOutput(resolved: Resolved, globals: GlobalOpts, secrets: string[]): Output {
  return {
    json: globals.json === true,
    stdout: resolved.stdout,
    stderr: resolved.stderr,
    secrets,
  };
}

/**
 * Builds the full authenticated context, or prints a structured NO_TOKEN error
 * and throws (exit 1) when no token can be resolved.
 */
export function buildContext(resolved: Resolved, globals: GlobalOpts): CommandContext {
  const resolution = resolveToken(resolved.env, resolved.tokenStore, globals.token);
  const secrets: string[] = resolution === null ? [] : [resolution.token];
  const out = buildOutput(resolved, globals, secrets);
  if (resolution === null) {
    printApiError(out, {
      code: 'NO_TOKEN',
      message:
        'No API token found. Set LABELGRID_API_TOKEN, run `labelgrid auth login`, or pass --token.',
      status: 0,
    });
    throw new CliError(1);
  }
  const baseUrl = resolveBaseUrl(resolved.env, globals.apiUrl);
  const { timeoutMs, rawTimeoutMs } = resolveTimeouts(resolved.env, globals, resolved.stderr);
  return {
    client: resolved.createClient({ baseUrl, token: resolution.token, timeoutMs, rawTimeoutMs }),
    out,
    yes: globals.yes === true,
    baseUrl,
    token: resolution.token,
    readLine: resolved.readLine,
  };
}
