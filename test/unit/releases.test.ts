import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { releaseTools } from '../../src/tools/releases.js';
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
  const t = releaseTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function lastInit(fetchFn: ReturnType<typeof vi.fn>): RequestInit {
  return fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit;
}
function lastBody(fetchFn: ReturnType<typeof vi.fn>): unknown {
  const b = lastInit(fetchFn).body;
  return typeof b === 'string' ? JSON.parse(b) : b;
}
function header(fetchFn: ReturnType<typeof vi.fn>, name: string): string | undefined {
  return (lastInit(fetchFn).headers as Record<string, string>)[name];
}

describe('releases toolset shape', () => {
  it('exports the seven consolidated release tools with the contracted gates', () => {
    expect(releaseTools.map((t) => t.name)).toEqual([
      'get_release_review',
      'get_delivery_queue',
      'get_landing_config',
      'list_track_licenses',
      'run_release_checks',
      'manage_release_links',
      'add_review_issue_note',
    ]);
    for (const t of releaseTools) expect(t.toolset).toBe('releases');
    for (const name of [
      'get_release_review',
      'get_delivery_queue',
      'get_landing_config',
      'list_track_licenses',
    ]) {
      expect(byName(name).gate).toBe('read');
      expect(byName(name).annotations.readOnlyHint).toBe(true);
    }
    for (const name of ['run_release_checks', 'manage_release_links', 'add_review_issue_note']) {
      expect(byName(name).gate).toBe('safe_write');
    }
    expect(byName('run_release_checks').annotations.idempotentHint).toBe(true);
  });
});

describe('get_release_review', () => {
  it('requires release_id and view via zod', () => {
    const schema = z.object(byName('get_release_review').inputShape);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ release_id: 1 }).success).toBe(false);
    expect(schema.safeParse({ release_id: 1, view: 'issues' }).success).toBe(true);
    expect(schema.safeParse({ release_id: 1, view: 'summary' }).success).toBe(false);
  });

  it('view=issues → GET /review-issues with release_id as a query param', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_release_review').handler({ release_id: 77, view: 'issues' }, ctx);
    expect(lastInit(fetchFn).method).toBe('GET');
    const url = lastUrl(fetchFn);
    expect(url).toContain('/review-issues');
    expect(url).toContain('release_id=77');
  });

  it('view=quality_report → GET /releases/{id}/quality-report', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_release_review').handler({ release_id: 33, view: 'quality_report' }, ctx);
    expect(lastUrl(fetchFn)).toContain('/releases/33/quality-report');
  });

  it('carries the Preflight QC add-on 403 caveat in the description', () => {
    const desc = byName('get_release_review').description;
    expect(desc).toContain('optional add-on');
    expect(desc).toContain('403');
  });

  it('projects concise by default: allowlisted issue fields + ids survive', async () => {
    const payload = {
      data: [{ id: 4, code: 'artwork_low_res', severity: 'error', internal_blob: 'x'.repeat(50) }],
    };
    const { ctx } = harness(payload);
    const r = await byName('get_release_review').handler({ release_id: 77, view: 'issues' }, ctx);
    expect('data' in r).toBe(true);
    const data = ('data' in r ? r.data : null) as Record<string, unknown>;
    expect(data._projection).toBe('concise');
    expect(data.data).toEqual([{ id: 4, code: 'artwork_low_res', severity: 'error' }]);
  });

  it("response_format='detailed' returns the verbatim response", async () => {
    const payload = { data: [{ id: 4, internal_blob: 'kept' }] };
    const { ctx } = harness(payload);
    const r = await byName('get_release_review').handler(
      { release_id: 77, view: 'issues', response_format: 'detailed' },
      ctx,
    );
    expect('data' in r && r.data).toEqual(payload);
  });
});

describe('get_delivery_queue', () => {
  it('→ GET /queues/distro with filter[...] params and pagination', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_delivery_queue').handler(
      { release_id: 21, outlet_id: 4, status: 'complete', per_page: 10 },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/queues/distro');
    expect(url).toContain('filter[release_id]=21');
    expect(url).toContain('filter[outlet_id]=4');
    expect(url).toContain('filter[status]=complete');
    expect(url).toContain('per_page=10');
  });

  it('projects concise by default and preserves ids', async () => {
    const payload = {
      data: [{ id: 1, outlet_id: 9, status: 'complete', internal_note: 'drop me' }],
    };
    const { ctx } = harness(payload);
    const r = await byName('get_delivery_queue').handler({}, ctx);
    const data = ('data' in r ? r.data : null) as Record<string, unknown>;
    expect(data._projection).toBe('concise');
    expect(data.data).toEqual([{ id: 1, outlet_id: 9, status: 'complete' }]);
  });

  it("response_format='detailed' returns the verbatim response", async () => {
    const payload = { data: [{ id: 1, internal_note: 'kept' }] };
    const { ctx } = harness(payload);
    const r = await byName('get_delivery_queue').handler({ response_format: 'detailed' }, ctx);
    expect('data' in r && r.data).toEqual(payload);
  });
});

describe('get_landing_config', () => {
  it('→ GET /releases/{id}/landing-config', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_landing_config').handler({ release_id: 21 }, ctx);
    expect(lastInit(fetchFn).method).toBe('GET');
    expect(lastUrl(fetchFn)).toContain('/releases/21/landing-config');
  });
});

describe('list_track_licenses', () => {
  it('without license_id → GET /tracks/{id}/licenses with pagination', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_track_licenses').handler({ track_id: 8, page: 1, per_page: 20 }, ctx);
    const url = lastUrl(fetchFn);
    expect(url).toContain('/tracks/8/licenses');
    expect(url).not.toContain('/licenses/');
    expect(url).toContain('per_page=20');
  });

  it('with license_id → GET /tracks/{id}/licenses/{licenseId}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_track_licenses').handler({ track_id: 8, license_id: 3 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/tracks/8/licenses/3');
  });
});

describe('run_release_checks', () => {
  it('rejects an unknown check via its zod enum', () => {
    const schema = z.object(byName('run_release_checks').inputShape);
    expect(schema.safeParse({ release_id: 1, check: 'lint' }).success).toBe(false);
    expect(schema.safeParse({ release_id: 1, check: 'validate' }).success).toBe(true);
  });

  it('check=validate → POST /releases/{id}/validate WITHOUT an auto Idempotency-Key', async () => {
    const { fetchFn, ctx } = harness();
    await byName('run_release_checks').handler({ release_id: 5, check: 'validate' }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/releases/5/validate');
    expect(header(fetchFn, 'Idempotency-Key')).toBeUndefined();
  });

  it('check=refresh_quality_report → POST /releases/{id}/quality-report/refresh', async () => {
    const { fetchFn, ctx } = harness();
    await byName('run_release_checks').handler(
      { release_id: 5, check: 'refresh_quality_report' },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/releases/5/quality-report/refresh');
  });

  it('carries the near-read and hourly-budget caveats in the description', () => {
    const desc = byName('run_release_checks').description;
    expect(desc).toContain('changes nothing');
    expect(desc).toContain('hourly refresh budget');
    expect(desc).toContain('errors_structured');
  });
});

describe('manage_release_links', () => {
  it('action=update_landing_config → PUT /releases/{id}/landing-config with config as the body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_release_links').handler(
      {
        release_id: 5,
        action: 'update_landing_config',
        config: { config_mode: 'custom', actions: [{ type: 'link' }] },
      },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('PUT');
    expect(lastUrl(fetchFn)).toContain('/releases/5/landing-config');
    expect(lastBody(fetchFn)).toEqual({ config_mode: 'custom', actions: [{ type: 'link' }] });
  });

  it('action=update_landing_config without config → INVALID_SELECTOR naming config, no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('manage_release_links').handler(
      { release_id: 5, action: 'update_landing_config' },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
    expect('error' in r && r.error.message).toContain('config');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('action=create_short_url → POST /releases/short-url with release_id body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_release_links').handler(
      { release_id: 5, action: 'create_short_url' },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/releases/short-url');
    expect(lastBody(fetchFn)).toEqual({ release_id: 5 });
  });

  it('carries the v2 action-list caveat in the description', () => {
    const desc = byName('manage_release_links').description;
    expect(desc).toContain('v2');
    expect(desc).toContain('action-list');
  });
});

describe('add_review_issue_note', () => {
  it('→ POST /review-issues/{id}/notes with note body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('add_review_issue_note').handler({ review_issue_id: 12, note: 'fixed it' }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/review-issues/12/notes');
    expect(lastBody(fetchFn)).toEqual({ note: 'fixed it' });
  });
});
