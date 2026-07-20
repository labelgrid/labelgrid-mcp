import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeStubClient, run } from '../helpers.js';

let dir: string;
let wavPath: string;
let jpgPath: string;
let mp3Path: string;
let movPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lg-cli-upload-'));
  wavPath = join(dir, 'master.wav');
  jpgPath = join(dir, 'cover.jpg');
  mp3Path = join(dir, 'lossy.mp3');
  movPath = join(dir, 'motion.mov');
  for (const p of [wavPath, jpgPath, mp3Path, movPath]) writeFileSync(p, 'bytes');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A stub wired for the presigned flow: mint → raw PUT → commit. */
function presignedStub() {
  return makeStubClient({
    resultFor: (method, path) =>
      method === 'post' && path.endsWith('/upload-url')
        ? { data: { upload_url: 'https://storage.example.test/signed', key: 'obj-key-1' } }
        : undefined,
  });
}

describe('upload — presigned track assets', () => {
  it('stereo runs mint → raw PUT (no auth) → commit against the track endpoints', async () => {
    const stub = presignedStub();
    const r = await run(['upload', wavPath, '--track', '4', '--type', 'stereo'], { stub });
    expect(r.code).toBe(0);
    expect(r.calls.map((c) => c.method)).toEqual(['post', 'raw', 'put']);
    expect(r.calls[0].args[0]).toBe('/tracks/4/files/stereo/upload-url');
    expect(r.calls[1].args[0]).toBe('https://storage.example.test/signed');
    const rawInit = r.calls[1].args[1] as RequestInit;
    expect(rawInit.method).toBe('PUT');
    expect((rawInit.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(r.calls[2].args[0]).toBe('/tracks/4/files/stereo');
    expect(r.calls[2].args[1]).toEqual({ s3_key: 'obj-key-1' });
    expect(r.calls[2].args[2]).toEqual({ idempotency: true, idempotencyKey: undefined });
  });

  it('motion-tall uses the release motion endpoints', async () => {
    const stub = presignedStub();
    const r = await run(['upload', movPath, '--release', '8', '--type', 'motion-tall'], { stub });
    expect(r.code).toBe(0);
    expect(r.calls[0].args[0]).toBe('/releases/8/files/tall/upload-url');
    expect(r.calls[2].args[0]).toBe('/releases/8/files/tall');
  });

  it('a disallowed extension is rejected before any call (exit 1)', async () => {
    const r = await run(['upload', mp3Path, '--track', '4', '--type', 'stereo']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('FILE_TYPE_NOT_ALLOWED');
    expect(r.calls).toHaveLength(0);
  });
});

describe('upload — cover art (multipart)', () => {
  it('routes to the release photo endpoint with the resolved file path', async () => {
    const r = await run(['upload', jpgPath, '--release', '8', '--type', 'cover-art']);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].method).toBe('postMultipart');
    expect(r.calls[0].args[0]).toBe('/releases/8/photo');
    expect(String(r.calls[0].args[1])).toContain('cover.jpg');
    expect(r.calls[0].args[2]).toBe('file');
  });
});

describe('upload — usage validation (exit 2)', () => {
  it('rejects a track type with --release', async () => {
    const r = await run(['upload', wavPath, '--release', '8', '--type', 'stereo']);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
  });

  it('rejects a release type with --track', async () => {
    const r = await run(['upload', jpgPath, '--track', '4', '--type', 'cover-art']);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
  });

  it('rejects both --track and --release', async () => {
    const r = await run(['upload', wavPath, '--track', '4', '--release', '8', '--type', 'stereo']);
    expect(r.code).toBe(2);
  });

  it('rejects neither --track nor --release', async () => {
    const r = await run(['upload', wavPath, '--type', 'stereo']);
    expect(r.code).toBe(2);
  });

  it('rejects an unknown --type', async () => {
    const r = await run(['upload', wavPath, '--track', '4', '--type', 'vinyl']);
    expect(r.code).toBe(2);
  });
});
