import { afterEach, describe, expect, it, vi } from 'vitest';
import { FULL_WRITES_ACK, loadConfig } from '../../src/config.js';

const TOKEN = 'lg_test_token';

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { LABELGRID_API_TOKEN: TOKEN, ...extra };
}

describe('loadConfig without a token (setup mode)', () => {
  it('enters setup mode instead of throwing when the token is missing', () => {
    const c = loadConfig({});
    expect(c.setupMode).toBe(true);
    expect(c.token).toBeNull();
    expect(c.writes).toBe(false);
    expect(c.fullWrites).toBe(false);
    expect(c.toolsets).toBeNull();
    expect(c.baseUrl).toBe('https://api.labelgrid.com/api/public');
  });

  it('enters setup mode when the token is empty/whitespace', () => {
    const c = loadConfig({ LABELGRID_API_TOKEN: '   ' });
    expect(c.setupMode).toBe(true);
    expect(c.token).toBeNull();
    expect(c.writes).toBe(false);
    expect(c.fullWrites).toBe(false);
  });
});

describe('loadConfig base url + token', () => {
  it('defaults the base url to production and carries the token, setupMode off', () => {
    const c = loadConfig(baseEnv());
    expect(c.token).toBe(TOKEN);
    expect(c.setupMode).toBe(false);
    expect(c.baseUrl).toBe('https://api.labelgrid.com/api/public');
  });

  it('overrides the base url from LABELGRID_API_URL', () => {
    const c = loadConfig(baseEnv({ LABELGRID_API_URL: 'https://api-sandbox.example/api/public' }));
    expect(c.baseUrl).toBe('https://api-sandbox.example/api/public');
  });
});

describe('loadConfig writes flags', () => {
  it('defaults writes to true', () => {
    expect(loadConfig(baseEnv()).writes).toBe(true);
  });

  it('disables writes when LABELGRID_ENABLE_WRITES=false', () => {
    expect(loadConfig(baseEnv({ LABELGRID_ENABLE_WRITES: 'false' })).writes).toBe(false);
  });

  it('LABELGRID_READ_ONLY=true forces writes and fullWrites off, winning over enable flags', () => {
    const c = loadConfig(
      baseEnv({
        LABELGRID_ENABLE_WRITES: 'true',
        LABELGRID_ENABLE_FULL_WRITES: 'true',
        LABELGRID_FULL_WRITES_ACK: FULL_WRITES_ACK,
        LABELGRID_READ_ONLY: 'true',
      }),
    );
    expect(c.writes).toBe(false);
    expect(c.fullWrites).toBe(false);
  });
});

describe('loadConfig fullWrites gating', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enables fullWrites only with the flag AND the exact ack sentence', () => {
    const c = loadConfig(
      baseEnv({
        LABELGRID_ENABLE_FULL_WRITES: 'true',
        LABELGRID_FULL_WRITES_ACK: FULL_WRITES_ACK,
      }),
    );
    expect(c.fullWrites).toBe(true);
  });

  it('keeps fullWrites false and warns with the exact ack string when the ack is wrong', () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const c = loadConfig(
      baseEnv({
        LABELGRID_ENABLE_FULL_WRITES: 'true',
        LABELGRID_FULL_WRITES_ACK: 'I promise to be careful',
      }),
    );
    expect(c.fullWrites).toBe(false);
    const written = err.mock.calls.map((call) => String(call[0])).join('\n');
    expect(written).toContain(FULL_WRITES_ACK);
  });

  it('keeps fullWrites false when the flag is set but no ack is provided', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const c = loadConfig(baseEnv({ LABELGRID_ENABLE_FULL_WRITES: 'true' }));
    expect(c.fullWrites).toBe(false);
  });

  it('defaults fullWrites to false', () => {
    expect(loadConfig(baseEnv()).fullWrites).toBe(false);
  });
});

describe('loadConfig toolsets', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is null (all toolsets) when LABELGRID_TOOLSETS is unset', () => {
    expect(loadConfig(baseEnv()).toolsets).toBeNull();
  });

  it('is null when LABELGRID_TOOLSETS is blank', () => {
    expect(loadConfig(baseEnv({ LABELGRID_TOOLSETS: '  ' })).toolsets).toBeNull();
  });

  it('parses a trimmed comma-separated list', () => {
    const c = loadConfig(baseEnv({ LABELGRID_TOOLSETS: 'catalog, releases ,analytics' }));
    expect(c.toolsets).not.toBeNull();
    expect([...(c.toolsets as Set<string>)].sort()).toEqual(['analytics', 'catalog', 'releases']);
  });

  it('warns on stderr for an unknown toolset name without throwing', () => {
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const c = loadConfig(baseEnv({ LABELGRID_TOOLSETS: 'catalog,bogus' }));
    const written = err.mock.calls.map((call) => String(call[0])).join('\n');
    expect(written).toContain('bogus');
    expect(c.toolsets?.has('catalog')).toBe(true);
  });
});
