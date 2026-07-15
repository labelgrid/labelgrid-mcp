import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { catalogWriteTools } from '../../src/tools/catalog-write.js';
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
  const t = catalogWriteTools.find((x) => x.name === name);
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

describe('catalog-write toolset shape', () => {
  it('exports the 14 catalog safe-write tools, all safe_write in the catalog toolset', () => {
    expect(catalogWriteTools.map((t) => t.name)).toEqual([
      'create_label',
      'update_label',
      'delete_label',
      'upload_label_image',
      'create_artist',
      'update_artist',
      'delete_artist',
      'upload_artist_photo',
      'create_writer',
      'update_writer',
      'delete_writer',
      'create_publisher',
      'update_publisher',
      'delete_publisher',
    ]);
    for (const t of catalogWriteTools) {
      expect(t.toolset).toBe('catalog');
      expect(t.gate).toBe('safe_write');
    }
    for (const name of ['delete_label', 'delete_artist', 'delete_writer', 'delete_publisher']) {
      expect(byName(name).annotations.destructiveHint).toBe(true);
    }
  });
});

describe('entity create/update/delete', () => {
  const cases: Array<[string, string, string, string]> = [
    ['create_label', 'POST', '/labels', ''],
    ['create_artist', 'POST', '/artists', ''],
    ['create_writer', 'POST', '/writers', ''],
    ['create_publisher', 'POST', '/publishers', ''],
  ];
  for (const [name, method, path] of cases) {
    it(`${name} → ${method} ${path} forwarding the fields object as the body`, async () => {
      const { fetchFn, ctx } = harness();
      await byName(name).handler({ fields: { name: 'Example Records', foo: 1 } }, ctx);
      expect(lastInit(fetchFn).method).toBe(method);
      expect(lastUrl(fetchFn)).toContain(path);
      expect(lastBody(fetchFn)).toEqual({ name: 'Example Records', foo: 1 });
    });
  }

  const updateCases: Array<[string, string, string]> = [
    ['update_label', 'label_id', '/labels/9'],
    ['update_artist', 'artist_id', '/artists/9'],
    ['update_writer', 'writer_id', '/writers/9'],
    ['update_publisher', 'publisher_id', '/publishers/9'],
  ];
  for (const [name, idField, path] of updateCases) {
    it(`${name} → PATCH ${path} with the fields body`, async () => {
      const { fetchFn, ctx } = harness();
      await byName(name).handler({ [idField]: 9, fields: { active: false } }, ctx);
      expect(lastInit(fetchFn).method).toBe('PATCH');
      expect(lastUrl(fetchFn)).toContain(path);
      expect(lastBody(fetchFn)).toEqual({ active: false });
    });
  }

  const deleteCases: Array<[string, string, string]> = [
    ['delete_label', 'label_id', '/labels/9'],
    ['delete_artist', 'artist_id', '/artists/9'],
    ['delete_writer', 'writer_id', '/writers/9'],
    ['delete_publisher', 'publisher_id', '/publishers/9'],
  ];
  for (const [name, idField, path] of deleteCases) {
    it(`${name} → DELETE ${path}`, async () => {
      const { fetchFn, ctx } = harness();
      await byName(name).handler({ [idField]: 9 }, ctx);
      expect(lastInit(fetchFn).method).toBe('DELETE');
      expect(lastUrl(fetchFn)).toContain(path);
    });
  }
});

describe('multipart image uploads', () => {
  let dir: string;
  let filePath: string;
  let txtPath: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-img-'));
    filePath = join(dir, 'logo.png');
    txtPath = join(dir, 'notes.txt');
    writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(txtPath, Buffer.from('hello'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('upload_label_image → multipart POST /labels/{id}/images/{imageType}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('upload_label_image').handler(
      { label_id: 4, image_type: 'logo', file_path: filePath },
      ctx,
    );
    const init = lastInit(fetchFn);
    expect(init.method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/labels/4/images/logo');
    expect(init.body instanceof FormData).toBe(true);
  });

  it('upload_artist_photo → multipart POST /artists/{id}/photo', async () => {
    const { fetchFn, ctx } = harness();
    await byName('upload_artist_photo').handler({ artist_id: 4, file_path: filePath }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/artists/4/photo');
    expect(lastInit(fetchFn).body instanceof FormData).toBe(true);
  });

  it('upload returns FILE_NOT_FOUND without any HTTP call for a missing file', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_label_image').handler(
      { label_id: 4, image_type: 'logo', file_path: join(dir, 'missing.png') },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_NOT_FOUND');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('upload returns FILE_NOT_FOUND when the path is a directory', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_artist_photo').handler({ artist_id: 4, file_path: dir }, ctx);
    expect('error' in r && r.error.code).toBe('FILE_NOT_FOUND');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a non-image extension with FILE_TYPE_NOT_ALLOWED and no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_label_image').handler(
      { label_id: 4, image_type: 'logo', file_path: txtPath },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
