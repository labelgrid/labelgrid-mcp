import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LabelGridClient } from '@labelgrid/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Config } from '../../src/config.js';
import { distributionTools } from '../../src/tools/distribution.js';
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
  const t = distributionTools.find((x) => x.name === name);
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

describe('distribution toolset shape', () => {
  it('exports the 7 consolidated distribution tools, every one gated full_write', () => {
    expect(distributionTools.map((t) => t.name)).toEqual([
      'upload_asset',
      'delete_asset',
      'manage_track_license',
      'distribute_release',
      'takedown_release',
      'confirm_review',
      'enable_beatport',
    ]);
    for (const t of distributionTools) {
      expect(t.toolset).toBe('distribution');
      expect(t.gate).toBe('full_write');
    }
  });

  it('marks the destructive tools with destructiveHint; confirm_review is both destructive and idempotent', () => {
    for (const name of [
      'delete_asset',
      'manage_track_license',
      'distribute_release',
      'takedown_release',
      'enable_beatport',
    ]) {
      expect(byName(name).annotations.destructiveHint).toBe(true);
    }
    // confirm_review has an irreversible consequence (destructiveHint) AND is
    // safe to repeat (idempotentHint) — both true.
    expect(byName('confirm_review').annotations.destructiveHint).toBe(true);
    expect(byName('confirm_review').annotations.idempotentHint).toBe(true);
  });

  it('states the consequential nature of distribute, takedown and enable_beatport', () => {
    expect(byName('distribute_release').description.toLowerCase()).toContain('final');
    expect(byName('distribute_release').description.toLowerCase()).toContain('weekly');
    expect(byName('takedown_release').description.toLowerCase()).toMatch(/final|all|remove/);
    expect(byName('enable_beatport').description.toLowerCase()).toMatch(/cannot|one-time|once/);
  });

  it('carries the immutability caveats in the upload/delete descriptions', () => {
    expect(byName('upload_asset').description).toContain('immutable');
    expect(byName('delete_asset').description).toContain('draft');
  });
});

describe('upload_asset', () => {
  let dir: string;
  let wav: string;
  let mp4: string;
  let jpg: string;
  let txtPath: string;
  let badSymlink: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-dist-'));
    wav = join(dir, 'song.wav');
    mp4 = join(dir, 'cover.mp4');
    jpg = join(dir, 'cover.jpg');
    txtPath = join(dir, 'notes.txt');
    badSymlink = join(dir, 'art.png');
    writeFileSync(wav, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    writeFileSync(mp4, Buffer.from([0x00, 0x00, 0x00, 0x18]));
    writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    writeFileSync(txtPath, Buffer.from('hello'));
    // A symlink NAMED like an image that points at a non-image file.
    symlinkSync(txtPath, badSymlink);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('target=track_stereo runs the presigned flow against the track file endpoints', async () => {
    const { fetchFn, ctx } = harness();
    await byName('upload_asset').handler({ target: 'track_stereo', id: 42, file_path: wav }, ctx);
    const urls = calls(fetchFn).map((c) => c.url);
    expect(urls[0]).toContain('/tracks/42/files/stereo/upload-url');
    expect(urls).toContain(PRESIGNED);
    expect(urls[urls.length - 1]).toContain('/tracks/42/files/stereo');
  });

  it('target=track_dolby and track_lyrics route to their fileType endpoints', async () => {
    const lrc = join(dir, 'lyrics.lrc');
    writeFileSync(lrc, Buffer.from('[00:01.00] la'));
    const cases: Array<[string, string, string]> = [
      ['track_dolby', wav, '/tracks/7/files/dolby'],
      ['track_lyrics', lrc, '/tracks/7/files/lyrics'],
    ];
    for (const [target, file, path] of cases) {
      const { fetchFn, ctx } = harness();
      await byName('upload_asset').handler({ target, id: 7, file_path: file }, ctx);
      const urls = calls(fetchFn).map((c) => c.url);
      expect(urls[0]).toContain(`${path}/upload-url`);
      expect(urls[urls.length - 1]).toContain(path);
    }
  });

  it('target=release_motion_* runs the presigned flow against the release file endpoints', async () => {
    const cases: Array<[string, string]> = [
      ['release_motion_square', '/releases/42/files/square'],
      ['release_motion_tall', '/releases/42/files/tall'],
    ];
    for (const [target, path] of cases) {
      const { fetchFn, ctx } = harness();
      await byName('upload_asset').handler({ target, id: 42, file_path: mp4 }, ctx);
      const urls = calls(fetchFn).map((c) => c.url);
      expect(urls[0]).toContain(`${path}/upload-url`);
      expect(urls).toContain(PRESIGNED);
      expect(urls[urls.length - 1]).toContain(path);
    }
  });

  it('target=release_cover_art → multipart POST /releases/{r}/photo with the file field', async () => {
    const { fetchFn, ctx } = harness();
    await byName('upload_asset').handler(
      { target: 'release_cover_art', id: 7, file_path: jpg },
      ctx,
    );
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/releases/7/photo');
    const form = last(fetchFn).init.body as FormData;
    expect(form instanceof FormData).toBe(true);
    expect(form.get('file')).toBeTruthy();
  });

  it('rejects a disallowed extension per target, making no HTTP call', async () => {
    const mp3 = join(dir, 'x.mp3');
    writeFileSync(mp3, Buffer.from([0x49, 0x44, 0x33]));
    const flac = join(dir, 'x.flac');
    writeFileSync(flac, Buffer.from([0x66, 0x4c, 0x61, 0x43]));
    const pdf = join(dir, 'x.pdf');
    writeFileSync(pdf, Buffer.from([0x25, 0x50, 0x44, 0x46]));
    const cases: Array<[string, string]> = [
      // audio: a .mp3 is not an accepted stereo master.
      ['track_stereo', mp3],
      // dolby accepts WAV only — a .flac must be rejected.
      ['track_dolby', flac],
      // lyrics: a .wav is not a lyrics file.
      ['track_lyrics', wav],
      // animated cover: a .wav is not a video.
      ['release_motion_square', wav],
      // static artwork: a .pdf is not an image.
      ['release_cover_art', pdf],
    ];
    for (const [target, file] of cases) {
      const { fetchFn, ctx } = harness();
      const r = await byName('upload_asset').handler({ target, id: 42, file_path: file }, ctx);
      expect('error' in r && r.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('rejects an image-named symlink that resolves to a non-image file (symlink resolution)', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_asset').handler(
      { target: 'release_cover_art', id: 7, file_path: badSymlink },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns FILE_NOT_FOUND without any HTTP call for a missing file', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('upload_asset').handler(
      { target: 'track_stereo', id: 42, file_path: join(dir, 'missing.wav') },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_NOT_FOUND');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects an unknown target via its zod enum', () => {
    const schema = z.object(byName('upload_asset').inputShape);
    expect(schema.safeParse({ target: 'track_video', id: 1, file_path: 'x.mp4' }).success).toBe(
      false,
    );
  });
});

describe('delete_asset', () => {
  it('track targets → DELETE /tracks/{t}/files/{type}', async () => {
    const cases: Array<[string, string]> = [
      ['track_stereo', '/tracks/5/files/stereo'],
      ['track_dolby', '/tracks/5/files/dolby'],
      ['track_lyrics', '/tracks/5/files/lyrics'],
    ];
    for (const [target, path] of cases) {
      const { fetchFn, ctx } = harness();
      await byName('delete_asset').handler({ target, id: 5 }, ctx);
      expect(last(fetchFn).init.method).toBe('DELETE');
      expect(last(fetchFn).url).toContain(path);
    }
  });

  it('release motion targets → DELETE /releases/{r}/files/{assetType}', async () => {
    const cases: Array<[string, string]> = [
      ['release_motion_square', '/releases/5/files/square'],
      ['release_motion_tall', '/releases/5/files/tall'],
    ];
    for (const [target, path] of cases) {
      const { fetchFn, ctx } = harness();
      await byName('delete_asset').handler({ target, id: 5 }, ctx);
      expect(last(fetchFn).init.method).toBe('DELETE');
      expect(last(fetchFn).url).toContain(path);
    }
  });

  it('does not offer cover art (no delete endpoint) — rejected by the zod enum', () => {
    const schema = z.object(byName('delete_asset').inputShape);
    expect(schema.safeParse({ target: 'release_cover_art', id: 1 }).success).toBe(false);
  });
});

describe('manage_track_license', () => {
  let dir: string;
  let pdf: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-lic-'));
    pdf = join(dir, 'license.pdf');
    writeFileSync(pdf, Buffer.from([0x25, 0x50, 0x44, 0x46]));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('action=upload → multipart POST /tracks/{t}/licenses with the type field', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_track_license').handler(
      { action: 'upload', track_id: 5, file_path: pdf, type: 'cover', license_id: 'LIC-42' },
      ctx,
    );
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/tracks/5/licenses');
    const form = last(fetchFn).init.body as FormData;
    expect(form instanceof FormData).toBe(true);
    expect(form.get('file')).toBeTruthy();
    expect(form.get('type')).toBe('cover');
    expect(form.get('license_id')).toBe('LIC-42');
  });

  it('action=update → multipart POST /tracks/{t}/licenses/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_track_license').handler(
      { action: 'update', track_id: 5, track_license_id: 8, file_path: pdf },
      ctx,
    );
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/tracks/5/licenses/8');
    expect(last(fetchFn).init.body instanceof FormData).toBe(true);
  });

  it('action=delete → DELETE /tracks/{t}/licenses/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_track_license').handler(
      { action: 'delete', track_id: 5, track_license_id: 8 },
      ctx,
    );
    expect(last(fetchFn).init.method).toBe('DELETE');
    expect(last(fetchFn).url).toContain('/tracks/5/licenses/8');
  });

  it('update/delete without track_license_id → INVALID_SELECTOR naming it, no HTTP call', async () => {
    for (const action of ['update', 'delete']) {
      const { fetchFn, ctx } = harness();
      const r = await byName('manage_track_license').handler(
        { action, track_id: 5, file_path: pdf },
        ctx,
      );
      expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
      expect('error' in r && r.error.message).toContain('track_license_id');
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('upload/update without file_path → INVALID_SELECTOR naming it, no HTTP call', async () => {
    const cases: Array<Record<string, unknown>> = [
      { action: 'upload', track_id: 5, type: 'cover' },
      { action: 'update', track_id: 5, track_license_id: 8 },
    ];
    for (const args of cases) {
      const { fetchFn, ctx } = harness();
      const r = await byName('manage_track_license').handler(args, ctx);
      expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
      expect('error' in r && r.error.message).toContain('file_path');
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-license extension with FILE_TYPE_NOT_ALLOWED and no HTTP call', async () => {
    const wav = join(dir, 'x.wav');
    writeFileSync(wav, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    const { fetchFn, ctx } = harness();
    const r = await byName('manage_track_license').handler(
      { action: 'upload', track_id: 5, file_path: wav, type: 'cover' },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('standalone distribution actions', () => {
  it('distribute_release → POST /releases/{r}/distribute with an idempotency key', async () => {
    const { fetchFn, ctx } = harness();
    await byName('distribute_release').handler({ release_id: 9 }, ctx);
    expect(last(fetchFn).init.method).toBe('POST');
    expect(last(fetchFn).url).toContain('/releases/9/distribute');
    expect(new Headers(last(fetchFn).init.headers).get('idempotency-key')).toBeTruthy();
  });

  it('distribute_release forwards a caller-supplied idempotency_key verbatim', async () => {
    const { fetchFn, ctx } = harness();
    await byName('distribute_release').handler(
      { release_id: 9, idempotency_key: 'reuse-this-key' },
      ctx,
    );
    expect(new Headers(last(fetchFn).init.headers).get('idempotency-key')).toBe('reuse-this-key');
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
});
