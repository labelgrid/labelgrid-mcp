import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/config.js';
import { type Gate, isToolEnabled } from '../../src/gating.js';

function config(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: 'https://api.example/api/public',
    token: 't',
    setupMode: false,
    writes: true,
    fullWrites: false,
    toolsets: null,
    ...overrides,
  };
}

function tool(gate: Gate, toolset: string) {
  return { gate, toolset };
}

describe('isToolEnabled reads', () => {
  it('enables a read tool whose toolset is selected', () => {
    expect(isToolEnabled(tool('read', 'catalog'), config({ toolsets: new Set(['catalog']) }))).toBe(
      true,
    );
  });

  it('enables a read tool when toolsets is null (all)', () => {
    expect(isToolEnabled(tool('read', 'analytics'), config({ toolsets: null }))).toBe(true);
  });

  it('disables a read tool whose toolset is not selected', () => {
    expect(
      isToolEnabled(tool('read', 'analytics'), config({ toolsets: new Set(['catalog']) })),
    ).toBe(false);
  });
});

describe('isToolEnabled safe writes', () => {
  it('enables a safe write only when writes is true and the toolset matches', () => {
    expect(isToolEnabled(tool('safe_write', 'catalog'), config({ writes: true }))).toBe(true);
  });

  it('disables a safe write when writes is false', () => {
    expect(isToolEnabled(tool('safe_write', 'catalog'), config({ writes: false }))).toBe(false);
  });

  it('disables a safe write when the toolset is not selected', () => {
    expect(
      isToolEnabled(
        tool('safe_write', 'releases'),
        config({ writes: true, toolsets: new Set(['catalog']) }),
      ),
    ).toBe(false);
  });
});

describe('isToolEnabled full writes', () => {
  it('enables a full write only when fullWrites is true and the toolset matches', () => {
    expect(isToolEnabled(tool('full_write', 'distribution'), config({ fullWrites: true }))).toBe(
      true,
    );
  });

  it('disables a full write when fullWrites is false even if writes is true', () => {
    expect(
      isToolEnabled(
        tool('full_write', 'distribution'),
        config({ writes: true, fullWrites: false }),
      ),
    ).toBe(false);
  });
});

describe('isToolEnabled fail-closed', () => {
  it('returns false for an unrecognized gate', () => {
    expect(isToolEnabled({ gate: 'nonsense' as Gate, toolset: 'catalog' }, config())).toBe(false);
  });
});
