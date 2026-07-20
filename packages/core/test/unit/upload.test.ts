import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertAllowedExtension } from '../../src/api/content-types.js';
import { LabelGridClient } from '../../src/api/http.js';
import { uploadViaPresignedUrl } from '../../src/api/upload.js';

const BASE = 'https://api.example.test/api/public';
const PRESIGNED = 'https://storage.example.test/upload/target?sig=abc123';

type Call = { url: string; init: RequestInit };

function client(fetchFn: typeof fetch): LabelGridClient {
  return new LabelGridClient({ baseUrl: BASE, token: 'secret-token', fetchFn, version: 't' });
}

/**
 * A fetch stub that plays the three-step presigned flow: the upload-url POST
 * yields a presigned URL + key, the presigned PUT succeeds, and the commit PUT
 * echoes the stored record. `putStatus` lets a test fail the presigned PUT.
 */
function flowStub(putStatus = 200) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init: init ?? {} });
    if (u.endsWith('/upload-url')) {
      return new Response(
        JSON.stringify({ upload_url: PRESIGNED, key: 'abc/song.wav', expires_in: 900 }),
        { status: 200 },
      );
    }
    if (u.startsWith('https://storage.example.test')) {
      return new Response(null, { status: putStatus });
    }
    return new Response(JSON.stringify({ id: 77, status: 'processing' }), { status: 200 });
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe('uploadViaPresignedUrl', () => {
  let dir: string;
  let wav: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-upload-'));
    wav = join(dir, 'song.wav');
    writeFileSync(wav, Buffer.from([0x52, 0x49, 0x46, 0x46]));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('returns FILE_NOT_FOUND without any HTTP call when the file is missing', async () => {
    const { fetchFn, calls } = flowStub();
    const r = await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: join(dir, 'does-not-exist.wav'),
    });
    expect('error' in r && r.error.code).toBe('FILE_NOT_FOUND');
    expect(calls.length).toBe(0);
  });

  it('returns FILE_NOT_FOUND without any HTTP call when the path is a directory', async () => {
    const { fetchFn, calls } = flowStub();
    const r = await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: dir,
    });
    expect('error' in r && r.error.code).toBe('FILE_NOT_FOUND');
    expect(calls.length).toBe(0);
  });

  it('runs upload-url → presigned PUT → commit in order and returns the commit body', async () => {
    const { fetchFn, calls } = flowStub();
    const r = await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: wav,
    });
    expect('data' in r).toBe(true);
    expect(calls.length).toBe(3);
    expect(calls[0].url).toBe(`${BASE}/tracks/42/files/stereo/upload-url`);
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ filename: 'song.wav' });
    expect(calls[1].url).toBe(PRESIGNED);
    expect(calls[1].init.method).toBe('PUT');
    expect(calls[2].url).toBe(`${BASE}/tracks/42/files/stereo`);
    expect(calls[2].init.method).toBe('PUT');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ s3_key: 'abc/song.wav' });
  });

  it('does NOT send the Bearer token on the presigned PUT', async () => {
    const { fetchFn, calls } = flowStub();
    await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: wav,
    });
    const put = calls.find((c) => c.url === PRESIGNED);
    const headers = new Headers(put?.init.headers);
    expect(headers.has('authorization')).toBe(false);
    // But the API calls DO carry the token.
    const commit = calls.find((c) => c.url === `${BASE}/tracks/42/files/stereo`);
    expect(new Headers(commit?.init.headers).get('authorization')).toBe('Bearer secret-token');
  });

  it('infers the Content-Type of the presigned PUT from the file extension', async () => {
    const { fetchFn, calls } = flowStub();
    await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: wav,
    });
    const put = calls.find((c) => c.url === PRESIGNED);
    expect(new Headers(put?.init.headers).get('content-type')).toBe('audio/wav');
  });

  it('aborts before the commit when the presigned PUT fails', async () => {
    const { fetchFn, calls } = flowStub(403);
    const r = await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: wav,
    });
    expect('error' in r && r.error.code).toBe('UPLOAD_FAILED');
    // Only upload-url + presigned PUT ran; the commit was never attempted.
    expect(calls.length).toBe(2);
    expect(calls.some((c) => c.url === `${BASE}/tracks/42/files/stereo`)).toBe(false);
  });

  it('sends an Idempotency-Key on the commit call', async () => {
    const { fetchFn, calls } = flowStub();
    await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: wav,
    });
    const commit = calls.find((c) => c.url === `${BASE}/tracks/42/files/stereo`);
    expect(new Headers(commit?.init.headers).get('idempotency-key')).toBeTruthy();
  });

  it('returns a generic UPLOAD_FAILED (no signed URL) when the presigned PUT throws', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/upload-url')) {
        return new Response(JSON.stringify({ upload_url: PRESIGNED, key: 'abc/song.wav' }), {
          status: 200,
        });
      }
      if (u.startsWith('https://storage.example.test')) {
        // A network error whose message embeds the signed URL — must NOT leak.
        throw new Error(`connect ECONNREFUSED ${PRESIGNED}`);
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const r = await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: wav,
    });
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('UPLOAD_FAILED');
      expect(r.error.message).toBe('Uploading the file to storage failed.');
      expect(JSON.stringify(r.error)).not.toContain('sig=');
      expect(JSON.stringify(r.error)).not.toContain(PRESIGNED);
    }
  });

  it('returns the upload-url error and never uploads when minting the URL fails', async () => {
    const calls: Call[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ message: 'nope' }), { status: 403 });
    }) as unknown as typeof fetch;
    const r = await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: wav,
    });
    expect('error' in r).toBe(true);
    expect(calls.length).toBe(1);
  });

  it('sanitizes the signed URL out of the failure log (never reaches stderr)', async () => {
    const leakUrl = 'https://storage.example.test/upload/target?sig=topsecretquery&exp=999';
    // An uppercase-scheme URL must be redacted too (case-insensitive matching).
    const upperLeak = 'HTTPS://STORAGE.EXAMPLE.TEST/UPLOAD/OTHER?sig=UPPERSECRETQUERY';
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/upload-url')) {
        return new Response(JSON.stringify({ upload_url: leakUrl, key: 'abc/song.wav' }), {
          status: 200,
        });
      }
      if (u.startsWith('https://storage.example.test')) {
        // The network error message embeds the signed URL — it must not be logged.
        throw new Error(`connect ECONNREFUSED ${leakUrl} also ${upperLeak}`);
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      const r = await uploadViaPresignedUrl(client(fetchFn), {
        uploadUrlPath: '/tracks/42/files/stereo/upload-url',
        commitPath: '/tracks/42/files/stereo',
        filePath: wav,
      });
      expect('error' in r && r.error.code).toBe('UPLOAD_FAILED');
    } finally {
      spy.mockRestore();
    }
    const logged = writes.join('');
    expect(logged).toContain('presigned upload PUT failed');
    expect(logged).toContain('[url]');
    expect(logged).not.toContain('sig=topsecretquery');
    expect(logged).not.toContain(leakUrl);
    expect(logged).not.toContain('UPPERSECRETQUERY');
    expect(logged).not.toContain(upperLeak);
  });

  it('returns FILE_NOT_FOUND when the file vanishes between validation and read', async () => {
    const gone = join(dir, 'vanishing.wav');
    writeFileSync(gone, Buffer.from([0x52, 0x49, 0x46, 0x46]));
    const calls: Call[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init: init ?? {} });
      if (u.endsWith('/upload-url')) {
        // TOCTOU race: the file is deleted after isReadableFile passed but
        // before the bytes are read.
        rmSync(gone, { force: true });
        return new Response(JSON.stringify({ upload_url: PRESIGNED, key: 'abc/song.wav' }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const r = await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: gone,
    });
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('FILE_NOT_FOUND');
      expect(r.error.message).toContain('could not be read');
    }
    // Only the mint POST ran — no presigned PUT, no commit.
    expect(calls.length).toBe(1);
    expect(calls.some((c) => c.url === PRESIGNED)).toBe(false);
  });

  it('uploads the ORIGINAL resolved target even when the symlink is retargeted after validation', async () => {
    // The guard resolves the symlink to its real target; the handler passes that
    // RESOLVED path onward, so the upload reads the real file directly. Retargeting
    // the symlink to a disallowed file between guard and read cannot redirect the
    // upload — the original target's bytes are what get sent.
    const target = join(dir, 'original-target.wav');
    const originalBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xaa, 0xbb, 0xcc]);
    writeFileSync(target, originalBytes);
    const decoy = join(dir, 'decoy.exe');
    writeFileSync(decoy, Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
    const link = join(dir, 'retarget-alias.wav');
    symlinkSync(target, link);

    // Validate the symlink the way a handler does: resolve it to the real path.
    const guard = assertAllowedExtension(link, ['.wav']);
    expect('realPath' in guard).toBe(true);
    const realPath = 'realPath' in guard ? guard.realPath : '';

    let putBody: Uint8Array | undefined;
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/upload-url')) {
        // Retarget the symlink to a disallowed file between guard and read.
        rmSync(link, { force: true });
        symlinkSync(decoy, link);
        return new Response(JSON.stringify({ upload_url: PRESIGNED, key: 'abc/song.wav' }), {
          status: 200,
        });
      }
      if (u.startsWith('https://storage.example.test')) {
        putBody = init?.body as Uint8Array;
        return new Response(null, { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const r = await uploadViaPresignedUrl(client(fetchFn), {
      uploadUrlPath: '/tracks/42/files/stereo/upload-url',
      commitPath: '/tracks/42/files/stereo',
      filePath: realPath,
    });
    expect('data' in r).toBe(true);
    // The bytes PUT to storage are the original target's, not the decoy's.
    expect(Buffer.from(putBody as Uint8Array)).toEqual(originalBytes);
  });
});
