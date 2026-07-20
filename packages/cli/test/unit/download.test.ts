import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_TOKEN, makeStubClient, run } from '../helpers.js';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lg-cli-download-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function trackStub(bytes = 'audio-bytes') {
  return makeStubClient({
    resultFor: (method, path) =>
      method === 'get' && path.endsWith('/download-url')
        ? { data: { download_url: 'https://cdn.example.test/signed-file', expires_in: 600 } }
        : undefined,
    rawResponse: () => new Response(bytes, { status: 200 }),
  });
}

describe('download --track', () => {
  it('mints the signed URL, fetches it with NO auth header, and writes --out', async () => {
    const out = join(dir, 'master.wav');
    const stub = trackStub();
    const r = await run(['download', '--track', '4', '--type', 'audio_24', '--out', out], { stub });
    expect(r.code).toBe(0);
    expect(r.calls[0]).toEqual({
      method: 'get',
      args: ['/tracks/4/files/audio_24/download-url', undefined],
    });
    expect(r.calls[1].method).toBe('raw');
    expect(r.calls[1].args[0]).toBe('https://cdn.example.test/signed-file');
    const rawInit = r.calls[1].args[1] as RequestInit;
    expect(rawInit.headers).toBeUndefined();
    expect(readFileSync(out, 'utf8')).toBe('audio-bytes');
    expect(r.stdout).toContain(out);
  });

  it('maps the preview aliases onto the API asset names', async () => {
    const stub = trackStub();
    const r = await run(
      ['download', '--track', '4', '--type', 'preview_clip', '--out', join(dir, 'clip.mp3')],
      { stub },
    );
    expect(r.code).toBe(0);
    expect(r.calls[0].args[0]).toBe('/tracks/4/files/audio_preview_clip/download-url');
  });

  it('never overwrites an existing file without --force', async () => {
    const out = join(dir, 'existing.wav');
    writeFileSync(out, 'original');
    const r = await run(['download', '--track', '4', '--type', 'audio_16', '--out', out], {
      stub: trackStub('new-bytes'),
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('FILE_EXISTS');
    expect(readFileSync(out, 'utf8')).toBe('original');
  });

  it('--force overwrites the existing file', async () => {
    const out = join(dir, 'existing2.wav');
    writeFileSync(out, 'original');
    const r = await run(
      ['download', '--track', '4', '--type', 'audio_16', '--out', out, '--force'],
      { stub: trackStub('new-bytes') },
    );
    expect(r.code).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe('new-bytes');
  });

  it('a relative --out is rejected before any call (exit 1, INVALID_PATH)', async () => {
    const r = await run(['download', '--track', '4', '--type', 'audio_16', '--out', 'rel.wav']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('INVALID_PATH');
    expect(r.calls).toHaveLength(0);
  });

  it('a missing parent directory is rejected (exit 1)', async () => {
    const r = await run([
      'download',
      '--track',
      '4',
      '--type',
      'audio_16',
      '--out',
      join(dir, 'nope', 'file.wav'),
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('INVALID_PATH');
    expect(r.calls).toHaveLength(0);
  });

  it('an invalid track type is a usage error (exit 2)', async () => {
    const r = await run(['download', '--track', '4', '--type', 'csv', '--out', join(dir, 'x.csv')]);
    expect(r.code).toBe(2);
  });
});

describe('download --statement', () => {
  it('csv fetches the statement CSV with an authed raw GET and writes --out', async () => {
    const out = join(dir, 'statement.csv');
    const stub = makeStubClient({ rawResponse: () => new Response('a,b\n1,2', { status: 200 }) });
    const r = await run(['download', '--statement', 'INV-42', '--type', 'csv', '--out', out], {
      stub,
    });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].method).toBe('raw');
    expect(String(r.calls[0].args[0])).toContain('/statements/INV-42/csv');
    const rawInit = r.calls[0].args[1] as RequestInit;
    expect((rawInit.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(readFileSync(out, 'utf8')).toBe('a,b\n1,2');
    // The token flows into the request header but never into the output.
    expect(r.stdout).not.toContain(TEST_TOKEN);
    expect(r.stderr).not.toContain(TEST_TOKEN);
  });

  it('invoice routes to the invoice PDF endpoint', async () => {
    const out = join(dir, 'invoice.pdf');
    const stub = makeStubClient({ rawResponse: () => new Response('%PDF', { status: 200 }) });
    const r = await run(['download', '--statement', 'INV-42', '--type', 'invoice', '--out', out], {
      stub,
    });
    expect(r.code).toBe(0);
    expect(String(r.calls[0].args[0])).toContain('/statements/INV-42/invoice');
    expect(readFileSync(out, 'utf8')).toBe('%PDF');
  });

  it('an HTTP error surfaces as a structured error (exit 1)', async () => {
    const stub = makeStubClient({
      rawResponse: () => new Response(JSON.stringify({ message: 'not found' }), { status: 404 }),
    });
    const r = await run(
      ['download', '--statement', 'INV-99', '--type', 'csv', '--out', join(dir, 'nf.csv')],
      { stub },
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('NOT_FOUND');
  });

  it('an invalid statement type is a usage error (exit 2)', async () => {
    const r = await run([
      'download',
      '--statement',
      'INV-1',
      '--type',
      'audio_16',
      '--out',
      join(dir, 'x'),
    ]);
    expect(r.code).toBe(2);
  });
});

describe('download — mode selection', () => {
  it('rejects both --track and --statement (exit 2)', async () => {
    const r = await run([
      'download',
      '--track',
      '4',
      '--statement',
      'INV-1',
      '--type',
      'csv',
      '--out',
      join(dir, 'x'),
    ]);
    expect(r.code).toBe(2);
  });

  it('rejects neither (exit 2)', async () => {
    const r = await run(['download', '--type', 'csv', '--out', join(dir, 'x')]);
    expect(r.code).toBe(2);
  });
});
