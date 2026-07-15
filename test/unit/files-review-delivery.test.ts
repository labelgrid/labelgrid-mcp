import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { deliveryTools } from '../../src/tools/delivery.js';
import { filesReadTools } from '../../src/tools/files-read.js';
import { reviewReadTools } from '../../src/tools/review-read.js';
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
function find(tools: ToolDef[], name: string): ToolDef {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function lastMethod(fetchFn: ReturnType<typeof vi.fn>): string | undefined {
  return (fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit).method;
}

describe('files-read tools', () => {
  it('all read-only in the catalog toolset', () => {
    expect(filesReadTools.map((t) => t.name)).toEqual([
      'get_track_file',
      'get_track_audio_download_url',
      'list_track_licenses',
      'get_track_license',
      'get_release_file',
    ]);
    for (const t of filesReadTools) {
      expect(t.gate).toBe('read');
      expect(t.toolset).toBe('catalog');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });

  it('get_track_file → GET /tracks/{id}/files/{type} with a validated file_type enum', async () => {
    const { fetchFn, ctx } = harness();
    await find(filesReadTools, 'get_track_file').handler(
      { track_id: 12, file_type: 'stereo' },
      ctx,
    );
    expect(lastMethod(fetchFn)).toBe('GET');
    expect(lastUrl(fetchFn)).toContain('/tracks/12/files/stereo');
    const schema = z.object(find(filesReadTools, 'get_track_file').inputShape);
    expect(schema.safeParse({ track_id: 1, file_type: 'flac' }).success).toBe(false);
  });

  it('get_track_audio_download_url → GET /tracks/{id}/files/{assetType}/download-url', async () => {
    const { fetchFn, ctx } = harness();
    const tool = find(filesReadTools, 'get_track_audio_download_url');
    await tool.handler({ track_id: 5, asset_type: 'audio_24' }, ctx);
    expect(lastUrl(fetchFn)).toContain('/tracks/5/files/audio_24/download-url');
    // The legacy stereo|dolby|lyrics values are no longer valid asset types.
    const schema = z.object(tool.inputShape);
    expect(schema.safeParse({ track_id: 1, asset_type: 'audio_preview_clip' }).success).toBe(true);
    expect(schema.safeParse({ track_id: 1, asset_type: 'dolby' }).success).toBe(false);
  });

  it('list_track_licenses → GET /tracks/{id}/licenses with pagination', async () => {
    const { fetchFn, ctx } = harness();
    await find(filesReadTools, 'list_track_licenses').handler(
      { track_id: 8, page: 1, per_page: 20 },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/tracks/8/licenses');
    expect(url).toContain('per_page=20');
  });

  it('get_track_license → GET /tracks/{id}/licenses/{licenseId}', async () => {
    const { fetchFn, ctx } = harness();
    await find(filesReadTools, 'get_track_license').handler({ track_id: 8, license_id: 3 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/tracks/8/licenses/3');
  });

  it('get_release_file → GET /releases/{id}/files/{assetType} with a validated enum', async () => {
    const { fetchFn, ctx } = harness();
    await find(filesReadTools, 'get_release_file').handler(
      { release_id: 4, asset_type: 'square' },
      ctx,
    );
    expect(lastUrl(fetchFn)).toContain('/releases/4/files/square');
    const schema = z.object(find(filesReadTools, 'get_release_file').inputShape);
    expect(schema.safeParse({ release_id: 1, asset_type: 'round' }).success).toBe(false);
  });
});

describe('review-read tools', () => {
  it('all read-only in the review toolset', () => {
    expect(reviewReadTools.map((t) => t.name)).toEqual([
      'list_review_issues',
      'list_issue_definitions',
      'get_quality_report',
      'list_stream_radar_flags',
      'get_stream_radar_flag',
    ]);
    for (const t of reviewReadTools) {
      expect(t.gate).toBe('read');
      expect(t.toolset).toBe('review');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });

  it('list_review_issues requires release_id and sends it as a query param', async () => {
    const { fetchFn, ctx } = harness();
    const tool = find(reviewReadTools, 'list_review_issues');
    expect(z.object(tool.inputShape).safeParse({}).success).toBe(false);
    await tool.handler({ release_id: 77 }, ctx);
    const url = lastUrl(fetchFn);
    expect(url).toContain('/review-issues');
    expect(url).toContain('release_id=77');
  });

  it('list_issue_definitions → GET /issue-definitions with no params', async () => {
    const { fetchFn, ctx } = harness();
    await find(reviewReadTools, 'list_issue_definitions').handler({}, ctx);
    expect(lastUrl(fetchFn)).toContain('/issue-definitions');
  });

  it('get_quality_report → GET /releases/{id}/quality-report', async () => {
    const { fetchFn, ctx } = harness();
    await find(reviewReadTools, 'get_quality_report').handler({ release_id: 33 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/releases/33/quality-report');
  });

  it('list_stream_radar_flags → GET /stream-radar/flags with filter[...] params', async () => {
    const { fetchFn, ctx } = harness();
    await find(reviewReadTools, 'list_stream_radar_flags').handler(
      { status: 'open', severity: 'high', release_id: 9, detected_from: '2026-06-01' },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/stream-radar/flags');
    expect(url).toContain('filter[status]=open');
    expect(url).toContain('filter[severity]=high');
    expect(url).toContain('filter[release_id]=9');
    expect(url).toContain('filter[detected_from]=2026-06-01');
  });

  it('get_stream_radar_flag → GET /stream-radar/flags/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await find(reviewReadTools, 'get_stream_radar_flag').handler({ flag_id: 55 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/stream-radar/flags/55');
  });
});

describe('delivery tools', () => {
  it('exports two read-only tools in the delivery toolset', () => {
    expect(deliveryTools.map((t) => t.name)).toEqual(['get_delivery_queue', 'get_landing_config']);
    for (const t of deliveryTools) {
      expect(t.gate).toBe('read');
      expect(t.toolset).toBe('delivery');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });

  it('get_delivery_queue → GET /queues/distro with filters', async () => {
    const { fetchFn, ctx } = harness();
    await find(deliveryTools, 'get_delivery_queue').handler(
      { release_id: 21, status: 'complete', per_page: 10 },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('/queues/distro');
    expect(url).toContain('filter[release_id]=21');
    expect(url).toContain('filter[status]=complete');
    expect(url).toContain('per_page=10');
  });

  it('get_landing_config → GET /releases/{id}/landing-config', async () => {
    const { fetchFn, ctx } = harness();
    await find(deliveryTools, 'get_landing_config').handler({ release_id: 21 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/releases/21/landing-config');
  });
});
