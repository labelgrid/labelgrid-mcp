import { describe, expect, it, vi } from 'vitest';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { catalogReadTools } from '../../src/tools/catalog-read.js';
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
  const t = catalogReadTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function lastMethod(fetchFn: ReturnType<typeof vi.fn>): string | undefined {
  return (fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit).method;
}

describe('catalog-read toolset shape', () => {
  it('exports exactly the 12 entity read tools, all read/read-only in the catalog toolset', () => {
    const names = catalogReadTools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'list_labels',
        'get_label',
        'list_artists',
        'get_artist',
        'list_writers',
        'get_writer',
        'list_publishers',
        'get_publisher',
        'list_releases',
        'get_release',
        'list_tracks',
        'get_track',
      ].sort(),
    );
    for (const t of catalogReadTools) {
      expect(t.gate).toBe('read');
      expect(t.toolset).toBe('catalog');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });
});

describe('list tools map to their collection endpoints with pagination + filters', () => {
  const listCases: Array<[string, string]> = [
    ['list_labels', '/labels'],
    ['list_artists', '/artists'],
    ['list_writers', '/writers'],
    ['list_publishers', '/publishers'],
    ['list_releases', '/releases'],
    ['list_tracks', '/tracks'],
  ];
  for (const [name, path] of listCases) {
    it(`${name} → GET ${path} with page/per_page`, async () => {
      const { fetchFn, ctx } = harness();
      await byName(name).handler({ page: 2, per_page: 50 }, ctx);
      expect(lastMethod(fetchFn)).toBe('GET');
      const url = lastUrl(fetchFn);
      expect(url).toContain(path);
      expect(url).toContain('page=2');
      expect(url).toContain('per_page=50');
    });
  }

  it('list_releases serializes documented filters under filter[...]', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_releases').handler(
      { label_id: 42, is_live: 1, cat: 'CAT001', barcode_number: '00602' },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('filter[label_id]=42');
    expect(url).toContain('filter[is_live]=1');
    expect(url).toContain('filter[cat]=CAT001');
    expect(url).toContain('filter[barcode_number]=00602');
  });

  it('list_tracks serializes release_id and isrc under filter[...]', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_tracks').handler({ release_id: 99, isrc: 'US1234500001' }, ctx);
    const url = lastUrl(fetchFn);
    expect(url).toContain('filter[release_id]=99');
    expect(url).toContain('filter[isrc]=US1234500001');
  });

  it('list_writers serializes name and ipi filters', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_writers').handler({ name: 'Jamie Doe', ipi: '00123456789' }, ctx);
    const url = lastUrl(fetchFn);
    expect(url).toContain('filter[name]=Jamie Doe');
    expect(url).toContain('filter[ipi]=00123456789');
  });
});

describe('get tools map to their item endpoints', () => {
  const getCases: Array<[string, string, string]> = [
    ['get_label', 'label_id', '/labels/7'],
    ['get_artist', 'artist_id', '/artists/7'],
    ['get_writer', 'writer_id', '/writers/7'],
    ['get_publisher', 'publisher_id', '/publishers/7'],
    ['get_release', 'release_id', '/releases/7'],
    ['get_track', 'track_id', '/tracks/7'],
  ];
  for (const [name, idField, path] of getCases) {
    it(`${name} → GET ${path}`, async () => {
      const { fetchFn, ctx } = harness();
      await byName(name).handler({ [idField]: 7 }, ctx);
      expect(lastMethod(fetchFn)).toBe('GET');
      expect(lastUrl(fetchFn)).toContain(path);
    });
  }
});
