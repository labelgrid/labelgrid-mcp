import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { analyticsTools } from '../../src/tools/analytics.js';
import { referenceTools } from '../../src/tools/reference.js';
import type { ToolContext, ToolDef } from '../../src/tools/types.js';

function harness() {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  const client = new LabelGridClient({
    baseUrl: 'https://api.example.test/api/public',
    token: 'tok',
    fetchFn: fetchFn as unknown as typeof fetch,
    version: 't',
  });
  const config: Config = {
    baseUrl: 'https://api.example.test/api/public',
    token: 'tok',
    setupMode: false,
    writes: true,
    fullWrites: true,
    toolsets: null,
  };
  return { fetchFn, ctx: { client, config } as ToolContext };
}

function byName(tools: ToolDef[], name: string): ToolDef {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function lastInit(fetchFn: ReturnType<typeof vi.fn>): RequestInit {
  return fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit;
}

describe('list_reference_data', () => {
  const tool = byName(referenceTools, 'list_reference_data');

  it('is a read tool in the reference toolset, marked read-only', () => {
    expect(tool.gate).toBe('read');
    expect(tool.toolset).toBe('reference');
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  const cases: Array<[string, string]> = [
    ['genres', '/genres'],
    ['genre_categories', '/genre-categories'],
    ['languages', '/languages'],
    ['contributor_roles', '/contributor-roles'],
    ['instruments', '/instruments'],
    ['distro_outlets', '/distro-outlets'],
    ['territories', '/territories'],
  ];
  for (const [type, path] of cases) {
    it(`maps type=${type} to GET ${path}`, async () => {
      const { fetchFn, ctx } = harness();
      await tool.handler({ type }, ctx);
      expect(lastInit(fetchFn).method).toBe('GET');
      expect(lastUrl(fetchFn)).toContain(path);
    });
  }

  it('rejects an unknown type via its zod enum', () => {
    const schema = z.object(tool.inputShape);
    expect(schema.safeParse({ type: 'nonsense' }).success).toBe(false);
    expect(schema.safeParse({ type: 'genres' }).success).toBe(true);
  });
});

describe('get_analytics', () => {
  const tool = byName(analyticsTools, 'get_analytics');

  it('is a read tool in the analytics toolset, marked read-only', () => {
    expect(tool.gate).toBe('read');
    expect(tool.toolset).toBe('analytics');
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  it('calls GET /analytics/summary with filtered dates and selected metrics', async () => {
    const { fetchFn, ctx } = harness();
    await tool.handler(
      {
        start_date: '2026-06-01',
        end_date: '2026-06-30',
        metrics: ['streams', 'saves'],
        platform: 'SPOTIFY',
        release_id: 42,
        artist_names: ['Example Records'],
      },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/analytics/summary');
    expect(url).toContain('filter[start_date]=2026-06-01');
    expect(url).toContain('filter[end_date]=2026-06-30');
    expect(url).toContain('filter[platform]=SPOTIFY');
    expect(url).toContain('filter[release_id]=42');
    expect(url).toContain('filter[artist_names][]=Example Records');
    expect(url).toContain('metrics[]=streams');
    expect(url).toContain('metrics[]=saves');
  });

  it('requires start_date and end_date and validates the metrics enum', () => {
    const schema = z.object(tool.inputShape);
    expect(schema.safeParse({ end_date: '2026-06-30' }).success).toBe(false);
    expect(schema.safeParse({ start_date: '2026-06-01', end_date: '2026-06-30' }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({
        start_date: '2026-06-01',
        end_date: '2026-06-30',
        metrics: ['not-a-metric'],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        start_date: '2026-06-01',
        end_date: '2026-06-30',
        metrics: ['completion-rate', 'streams-by-country'],
      }).success,
    ).toBe(true);
  });
});
