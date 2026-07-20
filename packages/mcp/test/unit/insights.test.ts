import { LabelGridClient } from '@labelgrid/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Config } from '../../src/config.js';
import { insightsTools } from '../../src/tools/insights.js';
import type { ToolContext, ToolDef } from '../../src/tools/types.js';

function harness(payload: unknown = { ok: true }) {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
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
function byName(name: string): ToolDef {
  const t = insightsTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function lastInit(fetchFn: ReturnType<typeof vi.fn>): RequestInit {
  return fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit;
}

describe('insights toolset shape', () => {
  it('exports the two read-only insights tools', () => {
    expect(insightsTools.map((t) => t.name)).toEqual([
      'get_analytics',
      'query_artificial_streaming',
    ]);
    for (const t of insightsTools) {
      expect(t.toolset).toBe('insights');
      expect(t.gate).toBe('read');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe('get_analytics', () => {
  it('requires start_date and end_date via zod', () => {
    const schema = z.object(byName('get_analytics').inputShape);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ start_date: '2026-01-01' }).success).toBe(false);
    expect(schema.safeParse({ start_date: '2026-01-01', end_date: '2026-01-31' }).success).toBe(
      true,
    );
  });

  it('→ GET /analytics/summary with the window and filters under filter[...]', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_analytics').handler(
      {
        start_date: '2026-01-01',
        end_date: '2026-01-31',
        platform: 'SPOTIFY',
        isrc: 'USRC17607839',
        artist_names: ['Maya'],
      },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('GET');
    const url = lastUrl(fetchFn);
    expect(url).toContain('/analytics/summary');
    expect(url).toContain('filter[start_date]=2026-01-01');
    expect(url).toContain('filter[end_date]=2026-01-31');
    expect(url).toContain('filter[platform]=SPOTIFY');
    expect(url).toContain('filter[isrc]=USRC17607839');
    expect(url).toContain('filter[artist_names][]=Maya');
  });

  it('sends metrics as a repeated top-level array param', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_analytics').handler(
      { start_date: '2026-01-01', end_date: '2026-01-31', metrics: ['streams', 'listeners'] },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('metrics[]=streams');
    expect(url).toContain('metrics[]=listeners');
  });

  it('rejects an unknown metric and platform via zod', () => {
    const schema = z.object(byName('get_analytics').inputShape);
    const base = { start_date: '2026-01-01', end_date: '2026-01-31' };
    expect(schema.safeParse({ ...base, metrics: ['downloads'] }).success).toBe(false);
    expect(schema.safeParse({ ...base, platform: 'TIDAL' }).success).toBe(false);
  });

  it('carries the 30-day window and rate-limit caveats in the description', () => {
    const desc = byName('get_analytics').description;
    expect(desc).toContain('30 days');
    expect(desc).toContain('429');
  });
});

describe('query_artificial_streaming', () => {
  it('rejects an unknown view via zod', () => {
    const schema = z.object(byName('query_artificial_streaming').inputShape);
    expect(schema.safeParse({ view: 'summary' }).success).toBe(false);
    expect(schema.safeParse({ view: 'flags' }).success).toBe(true);
  });

  it('view=flags → GET /stream-radar/flags with filter[...] + pagination', async () => {
    const { fetchFn, ctx } = harness();
    await byName('query_artificial_streaming').handler(
      {
        view: 'flags',
        page: 2,
        per_page: 25,
        filters: { status: 'open', severity: 'high', release_id: 9, detected_from: '2026-06-01' },
      },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/stream-radar/flags');
    expect(url).toContain('page=2');
    expect(url).toContain('per_page=25');
    expect(url).toContain('filter[status]=open');
    expect(url).toContain('filter[severity]=high');
    expect(url).toContain('filter[release_id]=9');
    expect(url).toContain('filter[detected_from]=2026-06-01');
  });

  it('view=flag_detail → GET /stream-radar/flags/{flag_id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('query_artificial_streaming').handler({ view: 'flag_detail', flag_id: 55 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/stream-radar/flags/55');
  });

  it('view=flag_detail without flag_id → INVALID_SELECTOR naming flag_id, no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('query_artificial_streaming').handler({ view: 'flag_detail' }, ctx);
    expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
    expect('error' in r && r.error.message).toContain('flag_id');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('view=records → GET /royalties/artificial-streams with top-level params', async () => {
    const { fetchFn, ctx } = harness();
    await byName('query_artificial_streaming').handler(
      { view: 'records', filters: { dsp: 'spotify', release_id: 7 }, cursor: 'abc', per_page: 50 },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/royalties/artificial-streams');
    expect(url).toContain('dsp=spotify');
    expect(url).toContain('release_id=7');
    expect(url).toContain('cursor=abc');
    expect(url).toContain('per_page=50');
    expect(url).not.toContain('filter[');
  });

  it('view=fee_breakdown → GET /artificial-streaming-fee/{period}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('query_artificial_streaming').handler(
      { view: 'fee_breakdown', period: '2026-01' },
      ctx,
    );
    expect(lastUrl(fetchFn)).toContain('/artificial-streaming-fee/2026-01');
  });

  it('view=fee_breakdown without period → INVALID_SELECTOR naming period, no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('query_artificial_streaming').handler({ view: 'fee_breakdown' }, ctx);
    expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
    expect('error' in r && r.error.message).toContain('period');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('carries the add-on 403 caveat in the description', () => {
    const desc = byName('query_artificial_streaming').description;
    expect(desc).toContain('optional add-on');
    expect(desc).toContain('403');
  });

  it('projects concise by default: allowlisted fields + ids survive', async () => {
    const payload = {
      data: [{ id: 3, isrc: 'USRC17607839', severity: 'high', analyzer_blob: 'drop me' }],
    };
    const { ctx } = harness(payload);
    const r = await byName('query_artificial_streaming').handler({ view: 'flags' }, ctx);
    const data = ('data' in r ? r.data : null) as Record<string, unknown>;
    expect(data._projection).toBe('concise');
    expect(data.data).toEqual([{ id: 3, isrc: 'USRC17607839', severity: 'high' }]);
  });

  it("response_format='detailed' returns the verbatim response", async () => {
    const payload = { data: [{ id: 3, analyzer_blob: 'kept' }] };
    const { ctx } = harness(payload);
    const r = await byName('query_artificial_streaming').handler(
      { view: 'flags', response_format: 'detailed' },
      ctx,
    );
    expect('data' in r && r.data).toEqual(payload);
  });
});
