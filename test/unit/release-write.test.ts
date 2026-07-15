import { describe, expect, it, vi } from 'vitest';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { releaseWriteTools } from '../../src/tools/release-write.js';
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
function byName(name: string): ToolDef {
  const t = releaseWriteTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function lastInit(fetchFn: ReturnType<typeof vi.fn>): RequestInit {
  return fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit;
}
function header(fetchFn: ReturnType<typeof vi.fn>, name: string): string | undefined {
  return (lastInit(fetchFn).headers as Record<string, string>)[name];
}
function lastBody(fetchFn: ReturnType<typeof vi.fn>): unknown {
  const b = lastInit(fetchFn).body;
  return typeof b === 'string' ? JSON.parse(b) : b;
}

describe('release-write toolset shape', () => {
  it('exports the 11 releases safe-write tools with the right gates and annotations', () => {
    expect(releaseWriteTools.map((t) => t.name)).toEqual([
      'create_release',
      'update_release',
      'delete_release',
      'create_track',
      'update_track',
      'delete_track',
      'validate_release',
      'refresh_quality_report',
      'update_landing_config',
      'create_release_short_url',
      'add_review_issue_note',
    ]);
    for (const t of releaseWriteTools) {
      expect(t.toolset).toBe('releases');
      expect(t.gate).toBe('safe_write');
    }
    expect(byName('delete_release').annotations.destructiveHint).toBe(true);
    expect(byName('delete_track').annotations.destructiveHint).toBe(true);
    for (const name of ['validate_release', 'refresh_quality_report', 'create_release_short_url']) {
      expect(byName(name).annotations.idempotentHint).toBe(true);
    }
  });
});

describe('release/track create+update+delete', () => {
  it('create_release → POST /releases with an auto Idempotency-Key and the fields body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('create_release').handler({ fields: { title: 'x', label_id: 42 } }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/releases');
    expect(header(fetchFn, 'Idempotency-Key')).toBeTruthy();
    expect(lastBody(fetchFn)).toEqual({ title: 'x', label_id: 42 });
  });

  it('create_release forwards a caller-supplied idempotency_key verbatim (not in the body)', async () => {
    const { fetchFn, ctx } = harness();
    await byName('create_release').handler(
      { fields: { title: 'x', label_id: 42 }, idempotency_key: 'reuse-this-key' },
      ctx,
    );
    expect(header(fetchFn, 'Idempotency-Key')).toBe('reuse-this-key');
    expect(lastBody(fetchFn)).toEqual({ title: 'x', label_id: 42 });
  });

  it('create_track → POST /tracks with an auto Idempotency-Key', async () => {
    const { fetchFn, ctx } = harness();
    await byName('create_track').handler(
      { fields: { release_id: 1, recording_country: 'US' } },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/tracks');
    expect(header(fetchFn, 'Idempotency-Key')).toBeTruthy();
  });

  it('update_release → PATCH /releases/{id} with the fields body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('update_release').handler({ release_id: 5, fields: { cat: 'CAT2' } }, ctx);
    expect(lastInit(fetchFn).method).toBe('PATCH');
    expect(lastUrl(fetchFn)).toContain('/releases/5');
    expect(lastBody(fetchFn)).toEqual({ cat: 'CAT2' });
  });

  it('delete_release → DELETE /releases/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('delete_release').handler({ release_id: 5 }, ctx);
    expect(lastInit(fetchFn).method).toBe('DELETE');
    expect(lastUrl(fetchFn)).toContain('/releases/5');
  });

  it('update_track → PATCH /tracks/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('update_track').handler({ track_id: 8, fields: { explicit: true } }, ctx);
    expect(lastInit(fetchFn).method).toBe('PATCH');
    expect(lastUrl(fetchFn)).toContain('/tracks/8');
    expect(lastBody(fetchFn)).toEqual({ explicit: true });
  });

  it('delete_track → DELETE /tracks/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('delete_track').handler({ track_id: 8 }, ctx);
    expect(lastInit(fetchFn).method).toBe('DELETE');
    expect(lastUrl(fetchFn)).toContain('/tracks/8');
  });
});

describe('release lifecycle actions', () => {
  it('validate_release → POST /releases/{id}/validate WITHOUT an auto Idempotency-Key', async () => {
    const { fetchFn, ctx } = harness();
    await byName('validate_release').handler({ release_id: 5 }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/releases/5/validate');
    expect(header(fetchFn, 'Idempotency-Key')).toBeUndefined();
  });

  it('refresh_quality_report → POST /releases/{id}/quality-report/refresh', async () => {
    const { fetchFn, ctx } = harness();
    await byName('refresh_quality_report').handler({ release_id: 5 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/releases/5/quality-report/refresh');
  });

  it('update_landing_config → PUT /releases/{id}/landing-config with the config body (no id in body)', async () => {
    const { fetchFn, ctx } = harness();
    await byName('update_landing_config').handler(
      { release_id: 5, config_mode: 'custom', actions: [{ type: 'link' }] },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('PUT');
    expect(lastUrl(fetchFn)).toContain('/releases/5/landing-config');
    expect(lastBody(fetchFn)).toEqual({ config_mode: 'custom', actions: [{ type: 'link' }] });
  });

  it('create_release_short_url → POST /releases/short-url with release_id body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('create_release_short_url').handler({ release_id: 5 }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/releases/short-url');
    expect(lastBody(fetchFn)).toEqual({ release_id: 5 });
  });

  it('add_review_issue_note → POST /review-issues/{id}/notes with note body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('add_review_issue_note').handler({ review_issue_id: 12, note: 'fixed it' }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/review-issues/12/notes');
    expect(lastBody(fetchFn)).toEqual({ note: 'fixed it' });
  });
});
