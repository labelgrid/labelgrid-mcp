/**
 * Environment parsing into a validated {@link Config}.
 *
 * When the token is absent the server does not fail: it enters setup mode
 * ({@link Config.setupMode}), which exposes only the `setup` helper tool. When a
 * token is present, write access is opt-out (safe writes on by default) and
 * full-write access is doubly opt-in (flag + an exact acknowledgment sentence).
 * A read-only override wins over everything.
 */

import { log } from './log.js';

export type Config = {
  baseUrl: string;
  /** The API token, or null when the server is running in setup mode. */
  token: string | null;
  /** True when no token is configured: only the `setup` tool is registered. */
  setupMode: boolean;
  writes: boolean;
  fullWrites: boolean;
  toolsets: Set<string> | null;
};

export const DEFAULT_BASE_URL = 'https://api.labelgrid.com/api/public';

/** The exact sentence a user must set in LABELGRID_FULL_WRITES_ACK to arm full writes. */
export const FULL_WRITES_ACK = 'I accept responsibility for AI-driven distribution actions';

/** The valid toolset names; unknown names in LABELGRID_TOOLSETS warn and are ignored. */
export const KNOWN_TOOLSETS: ReadonlySet<string> = new Set([
  'identity',
  'reference',
  'catalog',
  'releases',
  'review',
  'analytics',
  'accounting',
  'delivery',
  'webhooks',
  'distribution',
]);

/** Thrown when the environment cannot produce a usable config. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const baseUrl = env.LABELGRID_API_URL?.trim() || DEFAULT_BASE_URL;

  const token = env.LABELGRID_API_TOKEN?.trim();
  if (!token) {
    // No token: start in setup mode instead of failing. The server registers
    // only the `setup` tool, which guides the user through creating a token. No
    // API calls are possible until a token is configured, so writes are off.
    return {
      baseUrl,
      token: null,
      setupMode: true,
      writes: false,
      fullWrites: false,
      toolsets: null,
    };
  }

  const readOnly = isTruthy(env.LABELGRID_READ_ONLY);

  let writes =
    env.LABELGRID_ENABLE_WRITES === undefined ? true : isTruthy(env.LABELGRID_ENABLE_WRITES);

  const fullWritesFlag = isTruthy(env.LABELGRID_ENABLE_FULL_WRITES);
  const ackOk = env.LABELGRID_FULL_WRITES_ACK === FULL_WRITES_ACK;
  let fullWrites = fullWritesFlag && ackOk;
  if (fullWritesFlag && !ackOk) {
    log(
      'warn',
      `LABELGRID_ENABLE_FULL_WRITES is set but full writes stay OFF: set LABELGRID_FULL_WRITES_ACK to exactly "${FULL_WRITES_ACK}" to enable them.`,
    );
  }

  if (readOnly) {
    writes = false;
    fullWrites = false;
  }

  let toolsets: Set<string> | null = null;
  const rawToolsets = env.LABELGRID_TOOLSETS;
  if (rawToolsets !== undefined && rawToolsets.trim() !== '') {
    toolsets = new Set();
    for (const name of rawToolsets
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)) {
      if (!KNOWN_TOOLSETS.has(name)) {
        log('warn', `Unknown toolset in LABELGRID_TOOLSETS: "${name}" (ignored).`);
      }
      toolsets.add(name);
    }
  }

  return { baseUrl, token, setupMode: false, writes, fullWrites, toolsets };
}
