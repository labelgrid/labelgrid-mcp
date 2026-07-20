import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LabelGridClient } from '@labelgrid/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Config } from '../../src/config.js';
import { catalogTools } from '../../src/tools/catalog.js';
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
  const t = catalogTools.find((x) => x.name === name);
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
function lastIdempotencyKey(fetchFn: ReturnType<typeof vi.fn>): string | undefined {
  return (lastInit(fetchFn).headers as Record<string, string>)['Idempotency-Key'];
}

const ENTITY_PATHS: Array<[string, string]> = [
  ['label', '/labels'],
  ['artist', '/artists'],
  ['writer', '/writers'],
  ['publisher', '/publishers'],
  ['release', '/releases'],
  ['track', '/tracks'],
];

describe('catalog toolset shape', () => {
  it('exports the seven consolidated catalog tools with the contracted gates', () => {
    expect(catalogTools.map((t) => t.name)).toEqual([
      'search_catalog',
      'get_catalog_item',
      'create_catalog_item',
      'update_catalog_item',
      'delete_catalog_item',
      'upload_image',
      'get_asset',
    ]);
    for (const t of catalogTools) expect(t.toolset).toBe('catalog');
    for (const name of ['search_catalog', 'get_catalog_item', 'get_asset']) {
      expect(byName(name).gate).toBe('read');
      expect(byName(name).annotations.readOnlyHint).toBe(true);
    }
    for (const name of [
      'create_catalog_item',
      'update_catalog_item',
      'delete_catalog_item',
      'upload_image',
    ]) {
      expect(byName(name).gate).toBe('safe_write');
    }
    expect(byName('update_catalog_item').annotations.idempotentHint).toBe(true);
    expect(byName('delete_catalog_item').annotations.destructiveHint).toBe(true);
  });

  it('rejects an unknown entity via the zod enum on every entity tool', () => {
    for (const name of [
      'search_catalog',
      'get_catalog_item',
      'create_catalog_item',
      'update_catalog_item',
      'delete_catalog_item',
    ]) {
      const schema = z.object(byName(name).inputShape);
      expect(schema.safeParse({ entity: 'playlist', id: 1, fields: {} }).success).toBe(false);
    }
  });
});

describe('search_catalog', () => {
  for (const [entity, path] of ENTITY_PATHS) {
    it(`entity=${entity} → GET ${path} with pagination`, async () => {
      const { fetchFn, ctx } = harness();
      await byName('search_catalog').handler({ entity, page: 2, per_page: 50 }, ctx);
      expect(lastInit(fetchFn).method).toBe('GET');
      const url = lastUrl(fetchFn);
      expect(url).toContain(path);
      expect(url).toContain('page=2');
      expect(url).toContain('per_page=50');
    });
  }

  it('passes filters through verbatim under filter[...]', async () => {
    const { fetchFn, ctx } = harness();
    await byName('search_catalog').handler(
      {
        entity: 'release',
        filters: { label_id: 42, is_live: 1, cat: 'CAT001', barcode_number: '00602' },
      },
      ctx,
    );
    const url = lastUrl(fetchFn);
    expect(url).toContain('filter[label_id]=42');
    expect(url).toContain('filter[is_live]=1');
    expect(url).toContain('filter[cat]=CAT001');
    expect(url).toContain('filter[barcode_number]=00602');
  });

  it('projects concise by default: allowlisted fields + ids survive, the rest is dropped', async () => {
    const payload = {
      data: [{ id: 9, label_id: 3, title: 'Night Drive', bio_full: 'huge text blob' }],
    };
    const { ctx } = harness(payload);
    const r = await byName('search_catalog').handler({ entity: 'release' }, ctx);
    expect('data' in r).toBe(true);
    const data = ('data' in r ? r.data : null) as Record<string, unknown>;
    expect(data._projection).toBe('concise');
    expect(data.data).toEqual([{ id: 9, label_id: 3, title: 'Night Drive' }]);
  });

  it("response_format='detailed' bypasses projection and returns the verbatim response", async () => {
    const payload = { data: [{ id: 9, bio_full: 'huge text blob' }] };
    const { ctx } = harness(payload);
    const r = await byName('search_catalog').handler(
      { entity: 'release', response_format: 'detailed' },
      ctx,
    );
    expect('data' in r && r.data).toEqual(payload);
  });

  it('validates response_format via its zod enum', () => {
    const schema = z.object(byName('search_catalog').inputShape);
    expect(schema.safeParse({ entity: 'release', response_format: 'verbose' }).success).toBe(false);
    expect(schema.safeParse({ entity: 'release', response_format: 'concise' }).success).toBe(true);
    expect(schema.safeParse({ entity: 'release', response_format: 'detailed' }).success).toBe(true);
  });
});

describe('get_catalog_item', () => {
  for (const [entity, path] of ENTITY_PATHS) {
    it(`entity=${entity} → GET ${path}/{id}`, async () => {
      const { fetchFn, ctx } = harness();
      await byName('get_catalog_item').handler({ entity, id: 7 }, ctx);
      expect(lastInit(fetchFn).method).toBe('GET');
      expect(lastUrl(fetchFn)).toContain(`${path}/7`);
    });
  }

  it('projects concise by default and preserves ids', async () => {
    const payload = { id: 7, primary_genre_id: 12, name: 'Example Records', settings_blob: 'x' };
    const { ctx } = harness(payload);
    const r = await byName('get_catalog_item').handler({ entity: 'label', id: 7 }, ctx);
    expect('data' in r && r.data).toEqual({
      id: 7,
      primary_genre_id: 12,
      name: 'Example Records',
      _projection: 'concise',
    });
  });

  it("response_format='detailed' returns the verbatim response", async () => {
    const payload = { id: 7, settings_blob: 'x' };
    const { ctx } = harness(payload);
    const r = await byName('get_catalog_item').handler(
      { entity: 'label', id: 7, response_format: 'detailed' },
      ctx,
    );
    expect('data' in r && r.data).toEqual(payload);
  });
});

describe('create_catalog_item', () => {
  for (const [entity, path] of ENTITY_PATHS) {
    it(`entity=${entity} → POST ${path} forwarding the fields object as the body`, async () => {
      const { fetchFn, ctx } = harness();
      await byName('create_catalog_item').handler(
        { entity, fields: { name: 'Example Records', foo: 1 } },
        ctx,
      );
      expect(lastInit(fetchFn).method).toBe('POST');
      expect(lastUrl(fetchFn)).toContain(path);
      expect(lastBody(fetchFn)).toEqual({ name: 'Example Records', foo: 1 });
    });
  }

  it('sends the Idempotency-Key header for release and track creates', async () => {
    for (const entity of ['release', 'track']) {
      const { fetchFn, ctx } = harness();
      await byName('create_catalog_item').handler({ entity, fields: { a: 1 } }, ctx);
      expect(lastIdempotencyKey(fetchFn)).toBeDefined();
    }
  });

  it('uses a caller-supplied idempotency_key verbatim for release and track', async () => {
    for (const entity of ['release', 'track']) {
      const { fetchFn, ctx } = harness();
      await byName('create_catalog_item').handler(
        { entity, fields: { a: 1 }, idempotency_key: 'retry-key-12345678' },
        ctx,
      );
      expect(lastIdempotencyKey(fetchFn)).toBe('retry-key-12345678');
    }
  });

  it('NEVER sends the Idempotency-Key header for label/artist/writer/publisher, even when a key is passed', async () => {
    for (const entity of ['label', 'artist', 'writer', 'publisher']) {
      const { fetchFn, ctx } = harness();
      await byName('create_catalog_item').handler(
        { entity, fields: { a: 1 }, idempotency_key: 'retry-key-12345678' },
        ctx,
      );
      expect(lastIdempotencyKey(fetchFn)).toBeUndefined();
    }
  });

  it('validates idempotency_key length bounds via zod', () => {
    const schema = z.object(byName('create_catalog_item').inputShape);
    expect(
      schema.safeParse({ entity: 'release', fields: {}, idempotency_key: 'short' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ entity: 'release', fields: {}, idempotency_key: 'x'.repeat(129) }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ entity: 'release', fields: {}, idempotency_key: 'retry-key-12345678' })
        .success,
    ).toBe(true);
  });
});

describe('update_catalog_item', () => {
  for (const [entity, path] of ENTITY_PATHS) {
    it(`entity=${entity} → PATCH ${path}/{id} with the fields body`, async () => {
      const { fetchFn, ctx } = harness();
      await byName('update_catalog_item').handler(
        { entity, id: 9, fields: { active: false } },
        ctx,
      );
      expect(lastInit(fetchFn).method).toBe('PATCH');
      expect(lastUrl(fetchFn)).toContain(`${path}/9`);
      expect(lastBody(fetchFn)).toEqual({ active: false });
    });
  }

  it('carries the RELEASE_LOCKED_FIELDS caveat in the description', () => {
    expect(byName('update_catalog_item').description).toContain('RELEASE_LOCKED_FIELDS');
  });
});

describe('delete_catalog_item', () => {
  for (const [entity, path] of ENTITY_PATHS) {
    it(`entity=${entity} → DELETE ${path}/{id}`, async () => {
      const { fetchFn, ctx } = harness();
      await byName('delete_catalog_item').handler({ entity, id: 9 }, ctx);
      expect(lastInit(fetchFn).method).toBe('DELETE');
      expect(lastUrl(fetchFn)).toContain(`${path}/9`);
    });
  }

  it('carries the per-entity delete refusals in the description', () => {
    const desc = byName('delete_catalog_item').description;
    expect(desc).toContain('remove or reassign its releases first');
    expect(desc).toContain('referenced by releases or tracks');
    expect(desc).toContain('referenced by tracks');
    expect(desc).toContain('referenced by writers');
    expect(desc).toContain('draft');
  });
});

describe('upload_image', () => {
  let dir: string;
  let filePath: string;
  let txtPath: string;
  let badSymlink: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-img-'));
    filePath = join(dir, 'logo.png');
    txtPath = join(dir, 'notes.txt');
    badSymlink = join(dir, 'cover.png');
    writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(txtPath, Buffer.from('hello'));
    // A symlink NAMED like an image that points at a non-image file.
    symlinkSync(txtPath, badSymlink);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const labelTargets: Array<[string, string]> = [
    ['label_logo', '/labels/4/images/logo'],
    ['label_logo_dark', '/labels/4/images/logo-dark'],
    ['label_background', '/labels/4/images/background'],
  ];
  for (const [target, path] of labelTargets) {
    it(`target=${target} → multipart POST ${path}`, async () => {
      const { fetchFn, ctx } = harness();
      await byName('upload_image').handler({ target, id: 4, file_path: filePath }, ctx);
      const init = lastInit(fetchFn);
      expect(init.method).toBe('POST');
      expect(lastUrl(fetchFn)).toContain(path);
      expect(init.body instanceof FormData).toBe(true);
    });
  }

  it('target=artist_photo → multipart POST /artists/{id}/photo', async () => {
    const { fetchFn, ctx } = harness();
    await byName('upload_image').handler(
      { target: 'artist_photo', id: 4, file_path: filePath },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/artists/4/photo');
    expect(lastInit(fetchFn).body instanceof FormData).toBe(true);
  });

  it('rejects an unknown target via its zod enum', () => {
    const schema = z.object(byName('upload_image').inputShape);
    expect(schema.safeParse({ target: 'release_cover', id: 1, file_path: 'x.png' }).success).toBe(
      false,
    );
  });

  it('returns FILE_NOT_FOUND without any HTTP call for a missing file', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_image').handler(
      { target: 'label_logo', id: 4, file_path: join(dir, 'missing.png') },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_NOT_FOUND');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns FILE_NOT_FOUND when the path is a directory', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_image').handler(
      { target: 'artist_photo', id: 4, file_path: dir },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_NOT_FOUND');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a non-image extension with FILE_TYPE_NOT_ALLOWED and no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_image').handler(
      { target: 'label_logo', id: 4, file_path: txtPath },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects an image-named symlink that resolves to a non-image file (symlink resolution)', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_image').handler(
      { target: 'label_logo', id: 4, file_path: badSymlink },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('get_asset', () => {
  const ASSETS = [
    'stereo',
    'dolby',
    'lyrics',
    'square',
    'tall',
    'audio_16',
    'audio_24',
    'audio_32',
    'audio_preview_full',
    'audio_preview_clip',
  ] as const;
  const MODES = ['info', 'download_url'] as const;
  const PARENTS = ['track', 'release'] as const;

  /** The full valid matrix: (mode, parent, asset) → expected endpoint. */
  function expectedPath(mode: string, parent: string, asset: string): string | null {
    if (mode === 'info' && parent === 'track' && ['stereo', 'dolby', 'lyrics'].includes(asset)) {
      return `/tracks/12/files/${asset}`;
    }
    if (mode === 'info' && parent === 'release' && ['square', 'tall'].includes(asset)) {
      return `/releases/12/files/${asset}`;
    }
    if (
      mode === 'download_url' &&
      parent === 'track' &&
      ['audio_16', 'audio_24', 'audio_32', 'audio_preview_full', 'audio_preview_clip'].includes(
        asset,
      )
    ) {
      return `/tracks/12/files/${asset}/download-url`;
    }
    return null;
  }

  // Every cell of the 2×2×10 matrix: valid cells route, invalid cells error.
  for (const mode of MODES) {
    for (const parent of PARENTS) {
      for (const asset of ASSETS) {
        const path = expectedPath(mode, parent, asset);
        if (path !== null) {
          it(`VALID mode=${mode} parent=${parent} asset=${asset} → GET ${path}`, async () => {
            const { fetchFn, ctx } = harness();
            await byName('get_asset').handler({ parent, id: 12, asset, mode }, ctx);
            expect(lastInit(fetchFn).method).toBe('GET');
            expect(lastUrl(fetchFn)).toContain(path);
          });
        } else {
          it(`INVALID mode=${mode} parent=${parent} asset=${asset} → INVALID_SELECTOR, no HTTP call`, async () => {
            const { fetchFn, ctx } = harness();
            const r = await byName('get_asset').handler({ parent, id: 12, asset, mode }, ctx);
            expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
            expect('error' in r && r.error.message).toContain('Valid combinations');
            expect(fetchFn).not.toHaveBeenCalled();
          });
        }
      }
    }
  }

  it('mode defaults to info when omitted', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_asset').handler({ parent: 'track', id: 12, asset: 'stereo' }, ctx);
    expect(lastUrl(fetchFn)).toContain('/tracks/12/files/stereo');
    expect(lastUrl(fetchFn)).not.toContain('download-url');
  });

  it('rejects unknown parent/asset/mode values via the zod enums', () => {
    const schema = z.object(byName('get_asset').inputShape);
    expect(schema.safeParse({ parent: 'album', id: 1, asset: 'stereo' }).success).toBe(false);
    expect(schema.safeParse({ parent: 'track', id: 1, asset: 'flac' }).success).toBe(false);
    expect(
      schema.safeParse({ parent: 'track', id: 1, asset: 'stereo', mode: 'stream' }).success,
    ).toBe(false);
    expect(schema.safeParse({ parent: 'track', id: 1, asset: 'stereo' }).success).toBe(true);
  });

  it('carries the download-url expiry + no-token caveats in the description', () => {
    const desc = byName('get_asset').description;
    expect(desc).toContain('expires roughly 10 minutes');
    expect(desc).toContain('do not send your API token');
  });
});
