/**
 * Environment parsing into a validated {@link Config}.
 *
 * When the token is absent the server does not fail: it enters setup mode
 * ({@link Config.setupMode}), which exposes only the `setup` helper tool. When a
 * token is present, write access is opt-out (safe writes on by default) and
 * full-write access is doubly opt-in (flag + an exact acknowledgment sentence).
 * A read-only override wins over everything.
 */

import { log, parseTimeoutMs } from '@labelgrid/core';

export type Config = {
  baseUrl: string;
  /** The API token, or null when the server is running in setup mode. */
  token: string | null;
  /** True when no token is configured: only the `setup` tool is registered. */
  setupMode: boolean;
  writes: boolean;
  fullWrites: boolean;
  toolsets: Set<string> | null;
  /** JSON request timeout override (ms); undefined uses the client default. */
  timeoutMs?: number;
  /** Raw transfer (upload/download) timeout override (ms); undefined = default. */
  rawTimeoutMs?: number;
};

/**
 * Parses a timeout env var into a positive-integer ms, warning once (and
 * falling back to the client default) when the value is not a positive integer.
 */
function timeoutFromEnv(raw: string | undefined, varName: string): number | undefined {
  const parsed = parseTimeoutMs(raw);
  if (parsed.invalid) {
    log('warn', `${varName} must be a positive integer of milliseconds; ignoring "${raw}".`);
  }
  return parsed.value;
}

export const DEFAULT_BASE_URL = 'https://api.labelgrid.com/api/public';

/** The exact sentence a user must set in LABELGRID_FULL_WRITES_ACK to arm full writes. */
export const FULL_WRITES_ACK = 'I accept responsibility for AI-driven distribution actions';

/** The valid toolset names; unknown names in LABELGRID_TOOLSETS warn and are ignored. */
export const KNOWN_TOOLSETS: ReadonlySet<string> = new Set([
  'account',
  'reference',
  'catalog',
  'releases',
  'insights',
  'finance',
  'webhooks',
  'distribution',
]);

/**
 * Pre-0.3.0 toolset names still accepted in LABELGRID_TOOLSETS, translated to
 * their current toolset. Every legacy name used emits a stderr warning naming
 * the toolset it maps to (see loadConfig). Names that survived the regroup
 * (catalog, reference, releases, webhooks, distribution) map to themselves via
 * KNOWN_TOOLSETS and need no alias entry.
 */
export const LEGACY_TOOLSET_ALIASES: Readonly<Record<string, string>> = {
  identity: 'account',
  review: 'releases',
  delivery: 'releases',
  analytics: 'insights',
  accounting: 'finance',
};

/**
 * Toolsets excluded from the default surface when LABELGRID_TOOLSETS is unset
 * (`toolsets === null`). Naming one explicitly in LABELGRID_TOOLSETS enables
 * it. Consulted by gating and by the setup-mode listing, so the advertised
 * surface matches reality.
 */
export const defaultExcludedToolsets: ReadonlySet<string> = new Set(['webhooks']);

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
  const timeoutMs = timeoutFromEnv(env.LABELGRID_TIMEOUT_MS, 'LABELGRID_TIMEOUT_MS');
  const rawTimeoutMs = timeoutFromEnv(
    env.LABELGRID_TRANSFER_TIMEOUT_MS,
    'LABELGRID_TRANSFER_TIMEOUT_MS',
  );

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
      timeoutMs,
      rawTimeoutMs,
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
      const alias = LEGACY_TOOLSET_ALIASES[name];
      if (alias !== undefined) {
        // Legacy names still work, but warn loudly so the operator migrates —
        // and, for the review/delivery → releases remaps, flag that `releases`
        // also carries write tools so a read-only expectation is not violated.
        let warning = `Legacy toolset name "${name}" in LABELGRID_TOOLSETS maps to "${alias}" — update your configuration to use "${alias}".`;
        if (name === 'review' || name === 'delivery') {
          warning += ` Note: the mapped "${alias}" toolset also contains write tools (run_release_checks, manage_release_links, add_review_issue_note) — set LABELGRID_READ_ONLY=true or LABELGRID_ENABLE_WRITES=false to keep a read-only surface.`;
        }
        log('warn', warning);
        toolsets.add(alias);
        continue;
      }
      if (!KNOWN_TOOLSETS.has(name)) {
        log('warn', `Unknown toolset in LABELGRID_TOOLSETS: "${name}" (ignored).`);
      }
      toolsets.add(name);
    }
  }

  return {
    baseUrl,
    token,
    setupMode: false,
    writes,
    fullWrites,
    toolsets,
    timeoutMs,
    rawTimeoutMs,
  };
}
