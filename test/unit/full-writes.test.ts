import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { buildServer } from '../../src/server.js';
import { fullWriteTools } from '../../src/tools/full-writes.js';
import { identityTools } from '../../src/tools/identity.js';
import type { ToolContext, ToolDef } from '../../src/tools/types.js';

const BASE = 'https://api.example.test/api/public';
const PRESIGNED = 'https://storage.example.test/upload/target?sig=abc';

function harness() {
  const fetchFn = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith('/upload-url')) {
      return new Response(
        JSON.stringify({ upload_url: PRESIGNED, key: 'abc/asset.wav', expires_in: 900 }),
        { status: 200 },
      );
    }
    if (u.startsWith('https://storage.example.test')) {
      return new Response(null, { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const client = new LabelGridClient({
    baseUrl: BASE,
    token: 'tok',
    fetchFn: fetchFn as unknown as typeof fetch,
    version: 't',
  });
  const config: Config = {
    baseUrl: BASE,
    token: 'tok',
    setupMode: false,
    writes: true,
    fullWrites: true,
    toolsets: null,
  };
  return { fetchFn, ctx: { client, config } as ToolContext };
}

function byName(name: string): ToolDef {
  const t = fullWriteTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function calls(fetchFn: ReturnType<typeof vi.fn>): Array<{ url: string; init: RequestInit }> {
  return fetchFn.mock.calls.map((c) => ({
    url: decodeURIComponent(String(c[0])),
    init: (c[1] ?? {}) as RequestInit,
  }));
}
function last(fetchFn: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const all = calls(fetchFn);
  return all[all.length - 1];
}

const EXPECTED = [
  'upload_track_audio',
  'delete_track_audio',
  'upload_release_asset',
  'delete_release_asset',
  'upload_release_artwork',
  'upload_track_license',
  'update_track_license',
  'delete_track_license',
  'distribute_release',
  'takedown_release',
  'confirm_review',
  'enable_beatport',
];

describe('full-writes toolset shape', () => {
  it('exports the 12 distribution tools, every one gated full_write in the distribution toolset', () => {
    expect(fullWriteTools.map((t) => t.name)).toEqual(EXPECTED);
    for (const t of fullWriteTools) {
      expect(t.toolset).toBe('distribution');
      expect(t.gate).toBe('full_write');
    }
  });

  it('marks the destructive tools with destructiveHint', () => {
    for (const name of [
      'delete_track_audio',
      'delete_release_asset',
      'delete_track_license',
      'distribute_release',
      'takedown_release',
      'enable_beatport',
    ]) {
      expect(byName(name).annotations.destructiveHint).toBe(true);
    }
  });

  it('states the consequential nature of distribute, takedown and enable_beatport', () => {
    expect(byName('distribute_release').description.toLowerCase()).toContain('final');
    expect(byName('distribute_release').description.toLowerCase()).toContain('weekly');
    expect(byName('takedown_release').description.toLowerCase()).toMatch(/final|all|remove/);
    expect(byName('enable_beatport').description.toLowerCase()).toMatch(/cannot|one-time|once/);
  });
});

describe('full-writes endpoint mapping', () => {
  it('delete_track_audio → DELETE /tracks/{t}/files/{type}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('delete_track_audio').handler({ track_id: 5, file_type: 'stereo' }, ctx);
    expect(last(fetchFn).init.method).toBe('DELETE');
    expect(last(fetchFn).url).toContain('/tracks/5/files/stereo');
  });

  it('delete_release_asset → DELETE /releases/{r}/files/{assetType}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('delete_release_asset').handler({ release_id: 5, asset_type: 'square' }, ctx);
    expect(last(fetchFn).init.method).toBe('DELETE');
    expect(last(fetchFn).url).toContain('/releases/5/files/square');
  });

  it('distribute_release → POST /releases/{r}/distribute with an idempotency key', async () => {
    const { fetchFn, ctx } = harness();
    await byName('distribute_release').handler({ release_id: 9 }, ctx);
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/releases/9/distribute');
    expect(new Headers(last(fetchFn).init.headers).get('idempotency-key')).toBeTruthy();
  });

  it('takedown_release → POST /releases/{r}/takedown-all', async () => {
    const { fetchFn, ctx } = harness();
    await byName('takedown_release').handler({ release_id: 9 }, ctx);
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/releases/9/takedown-all');
  });

  it('confirm_review → POST /releases/{r}/confirm-review', async () => {
    const { fetchFn, ctx } = harness();
    await byName('confirm_review').handler({ release_id: 9 }, ctx);
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/releases/9/confirm-review');
  });

  it('enable_beatport → POST /labels/{id}/enable-beatport', async () => {
    const { fetchFn, ctx } = harness();
    await byName('enable_beatport').handler({ label_id: 3 }, ctx);
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/labels/3/enable-beatport');
  });

  it('delete_track_license → DELETE /tracks/{t}/licenses/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('delete_track_license').handler({ track_id: 5, track_license_id: 8 }, ctx);
    expect(last(fetchFn).init.method).toBe('DELETE');
    expect(last(fetchFn).url).toContain('/tracks/5/licenses/8');
  });
});

describe('full-writes uploads', () => {
  let dir: string;
  let wav: string;
  let pdf: string;
  let mp4: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-fw-'));
    wav = join(dir, 'song.wav');
    pdf = join(dir, 'license.pdf');
    mp4 = join(dir, 'cover.mp4');
    writeFileSync(wav, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    writeFileSync(pdf, Buffer.from([0x25, 0x50, 0x44, 0x46]));
    writeFileSync(mp4, Buffer.from([0x00, 0x00, 0x00, 0x18]));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('upload_track_audio runs the presigned flow against the track file endpoints', async () => {
    const { fetchFn, ctx } = harness();
    await byName('upload_track_audio').handler(
      { track_id: 42, file_type: 'stereo', file_path: wav },
      ctx,
    );
    const urls = calls(fetchFn).map((c) => c.url);
    expect(urls[0]).toContain('/tracks/42/files/stereo/upload-url');
    expect(urls).toContain(PRESIGNED);
    expect(urls[urls.length - 1]).toContain('/tracks/42/files/stereo');
  });

  it('upload_release_asset runs the presigned flow against the release file endpoints', async () => {
    const { fetchFn, ctx } = harness();
    await byName('upload_release_asset').handler(
      { release_id: 42, asset_type: 'square', file_path: mp4 },
      ctx,
    );
    const urls = calls(fetchFn).map((c) => c.url);
    expect(urls[0]).toContain('/releases/42/files/square/upload-url');
    expect(urls).toContain(PRESIGNED);
    expect(urls[urls.length - 1]).toContain('/releases/42/files/square');
  });

  it('rejects a disallowed extension per upload family, making no HTTP call', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      // audio: a .mp3 is not an accepted stereo master.
      ['upload_track_audio', { track_id: 42, file_type: 'stereo', file_path: join(dir, 'x.mp3') }],
      // animated cover: a .wav is not a video.
      ['upload_release_asset', { release_id: 42, asset_type: 'square', file_path: wav }],
      // static artwork: a .pdf is not an image.
      ['upload_release_artwork', { release_id: 7, file_path: pdf }],
      // license: a .wav is not a license document.
      ['upload_track_license', { track_id: 5, file_path: wav, type: 'cover' }],
    ];
    for (const [name, args] of cases) {
      const { fetchFn, ctx } = harness();
      // These paths point at real files (wav/pdf) or a non-existent one; the
      // extension guard must fire regardless, before any network call.
      writeFileSync(join(dir, 'x.mp3'), Buffer.from([0x49, 0x44, 0x33]));
      const r = await byName(name).handler(args, ctx);
      expect('error' in r && r.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('upload_release_artwork → multipart POST /releases/{r}/photo with the file field', async () => {
    const { fetchFn, ctx } = harness();
    const jpg = join(dir, 'cover.jpg');
    writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await byName('upload_release_artwork').handler({ release_id: 7, file_path: jpg }, ctx);
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/releases/7/photo');
    const form = last(fetchFn).init.body as FormData;
    expect(form instanceof FormData).toBe(true);
    expect(form.get('file')).toBeTruthy();
  });

  it('upload_track_license → multipart POST /tracks/{t}/licenses with the type field', async () => {
    const { fetchFn, ctx } = harness();
    await byName('upload_track_license').handler(
      { track_id: 5, file_path: pdf, type: 'cover' },
      ctx,
    );
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/tracks/5/licenses');
    expect(last(fetchFn).init.body instanceof FormData).toBe(true);
  });

  it('update_track_license → multipart POST /tracks/{t}/licenses/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('update_track_license').handler(
      { track_id: 5, track_license_id: 8, file_path: pdf },
      ctx,
    );
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/tracks/5/licenses/8');
    expect(last(fetchFn).init.body instanceof FormData).toBe(true);
  });

  it('upload_track_audio returns FILE_NOT_FOUND without any HTTP call for a missing file', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_track_audio').handler(
      { track_id: 42, file_type: 'stereo', file_path: join(dir, 'missing.wav') },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_NOT_FOUND');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('full-writes server gating', () => {
  async function listNames(fullWrites: boolean): Promise<string[]> {
    const apiClient = new LabelGridClient({ baseUrl: BASE, token: 'tok', version: 't' });
    const config: Config = {
      baseUrl: BASE,
      token: 'tok',
      setupMode: false,
      writes: true,
      fullWrites,
      toolsets: null,
    };
    // Include the always-on identity reads so the server advertises the tools
    // capability even when every full-write tool is gated off (as the real
    // server always carries read tools).
    const server = buildServer(config, apiClient, [...identityTools, ...fullWriteTools]);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    const { tools } = await client.listTools();
    await client.close();
    return tools.map((t) => t.name);
  }

  it('registers none of the 12 full-write tools when full writes are off', async () => {
    const names = await listNames(false);
    for (const n of EXPECTED) expect(names).not.toContain(n);
  });

  it('registers all 12 full-write tools when full writes are on', async () => {
    const names = await listNames(true);
    for (const n of EXPECTED) expect(names).toContain(n);
  });
});
