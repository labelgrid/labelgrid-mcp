import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertAllowedExtension, contentType } from '../../src/api/content-types.js';

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff'];

describe('contentType', () => {
  it('infers a MIME type from the extension, defaulting to octet-stream', () => {
    expect(contentType('/x/song.wav')).toBe('audio/wav');
    expect(contentType('/x/COVER.JPG')).toBe('image/jpeg');
    expect(contentType('/x/mystery.bin')).toBe('application/octet-stream');
  });
});

describe('assertAllowedExtension', () => {
  let dir: string;
  let realJpg: string;
  let realExe: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-ext-'));
    realJpg = join(dir, 'real.jpg');
    realExe = join(dir, 'payload.exe');
    writeFileSync(realJpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    writeFileSync(realExe, Buffer.from([0x4d, 0x5a]));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('rejects a plainly-disallowed extension on the fast path', () => {
    const res = assertAllowedExtension('/x/notes.txt', IMAGE_EXTS);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
      expect(res.error.message).toContain('got ".txt"');
    }
  });

  it('resolves a real file whose extension is in the allowlist to its real path', () => {
    const res = assertAllowedExtension(realJpg, IMAGE_EXTS);
    expect('realPath' in res).toBe(true);
    if ('realPath' in res) expect(res.realPath).toBe(realpathSync(realJpg));
  });

  it('rejects a symlink with an allowed name that resolves to a disallowed file', () => {
    const link = join(dir, 'cover.jpg');
    symlinkSync(realExe, link);
    const res = assertAllowedExtension(link, IMAGE_EXTS);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
      expect(res.error.message).toContain('resolves to a ".exe" file');
    }
  });

  it('resolves a symlink with an allowed name to the allowed real target, not the link', () => {
    const link = join(dir, 'alias.png');
    symlinkSync(realJpg, link);
    const res = assertAllowedExtension(link, IMAGE_EXTS);
    expect('realPath' in res).toBe(true);
    // The resolved path is the real target — reading THAT ignores the symlink.
    if ('realPath' in res) expect(res.realPath).toBe(realpathSync(realJpg));
  });

  it('returns FILE_NOT_FOUND when an allowed-extension path does not resolve', () => {
    const res = assertAllowedExtension(join(dir, 'missing.png'), IMAGE_EXTS);
    expect('error' in res).toBe(true);
    if ('error' in res) {
      expect(res.error.code).toBe('FILE_NOT_FOUND');
      expect(res.error.message).toContain('No readable file at');
    }
  });
});
