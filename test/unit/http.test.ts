import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ApiResult, LabelGridClient } from '../../src/api/http.js';

const BASE = 'https://api.example.test/api/public';
const VERSION = '9.9.9';

function jsonResponse(status: number, body?: unknown, headers?: Record<string, string>): Response {
  const init: ResponseInit = { status, headers };
  if (body === undefined) {
    return new Response(null, init);
  }
  return new Response(JSON.stringify(body), init);
}

function makeClient(fetchFn: typeof fetch) {
  return new LabelGridClient({ baseUrl: BASE, token: 'tok-123', fetchFn, version: VERSION });
}

function lastInit(fetchFn: ReturnType<typeof vi.fn>): RequestInit {
  return fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]);
}
function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

function isOk<T>(r: ApiResult<T>): r is { data: T } {
  return 'data' in r;
}

describe('LabelGridClient headers', () => {
  it('sends Authorization, Accept and versioned User-Agent on every request', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }));
    await makeClient(fetchFn as unknown as typeof fetch).get('/me');
    const init = lastInit(fetchFn);
    expect(headerOf(init, 'Authorization')).toBe('Bearer tok-123');
    expect(headerOf(init, 'Accept')).toBe('application/json');
    expect(headerOf(init, 'User-Agent')).toBe(`labelgrid-mcp/${VERSION}`);
  });
});

describe('LabelGridClient query serialization', () => {
  it('serializes nested filter[...] objects and array[] values', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, []));
    await makeClient(fetchFn as unknown as typeof fetch).get('/releases', {
      filter: { label_id: 5 },
      metrics: ['streams', 'saves'],
      page: 2,
      skip: undefined,
    });
    const url = decodeURIComponent(lastUrl(fetchFn));
    expect(url).toContain('filter[label_id]=5');
    expect(url).toContain('metrics[]=streams');
    expect(url).toContain('metrics[]=saves');
    expect(url).toContain('page=2');
    expect(url).not.toContain('skip');
  });
});

describe('LabelGridClient idempotency', () => {
  it('adds an Idempotency-Key when idempotency:true', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    await makeClient(fetchFn as unknown as typeof fetch).post(
      '/releases',
      { title: 'x' },
      {
        idempotency: true,
      },
    );
    const key = headerOf(lastInit(fetchFn), 'Idempotency-Key');
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('generates a fresh key per idempotent call', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const c = makeClient(fetchFn as unknown as typeof fetch);
    await c.post('/releases', {}, { idempotency: true });
    const k1 = headerOf(lastInit(fetchFn), 'Idempotency-Key');
    await c.post('/releases', {}, { idempotency: true });
    const k2 = headerOf(lastInit(fetchFn), 'Idempotency-Key');
    expect(k1).toBeTruthy();
    expect(k2).toBeTruthy();
    expect(k1).not.toBe(k2);
  });

  it('omits the Idempotency-Key when not requested', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    await makeClient(fetchFn as unknown as typeof fetch).post('/labels', { name: 'x' });
    expect(headerOf(lastInit(fetchFn), 'Idempotency-Key')).toBeUndefined();
  });

  it('uses a caller-supplied idempotency key verbatim', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    await makeClient(fetchFn as unknown as typeof fetch).post(
      '/releases',
      {},
      { idempotency: true, idempotencyKey: 'my-fixed-key-123' },
    );
    expect(headerOf(lastInit(fetchFn), 'Idempotency-Key')).toBe('my-fixed-key-123');
  });
});

describe('LabelGridClient success bodies', () => {
  it('returns { data } for a 2xx JSON body', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { id: 42 }));
    const r = await makeClient(fetchFn as unknown as typeof fetch).get<{ id: number }>(
      '/releases/42',
    );
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.data.id).toBe(42);
  });

  it('returns { data: null } for an empty 204 body', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(204));
    const r = await makeClient(fetchFn as unknown as typeof fetch).delete('/labels/1');
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.data).toBeNull();
  });
});

describe('LabelGridClient error normalization', () => {
  it('maps 401 to TOKEN_INVALID with a token suggestion and never throws', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { message: 'Unauthenticated.' }));
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/me');
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) {
      expect(r.error.code).toBe('TOKEN_INVALID');
      expect(r.error.status).toBe(401);
      expect(r.error.suggestion).toContain('LABELGRID_API_TOKEN');
    }
  });

  it('passes through a server code on 403', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(403, {
        error: { code: 'RELEASE_LOCKED_FIELDS', message: 'Some fields are locked' },
      }),
    );
    const r = await makeClient(fetchFn as unknown as typeof fetch).patch('/releases/1', {});
    if (!isOk(r)) {
      expect(r.error.code).toBe('RELEASE_LOCKED_FIELDS');
      expect(r.error.message).toBe('Some fields are locked');
    }
  });

  it('falls back to FORBIDDEN on 403 without a code', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(403, { message: 'Your plan does not allow this' }),
    );
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/x');
    if (!isOk(r)) {
      expect(r.error.code).toBe('FORBIDDEN');
      expect(r.error.message).toBe('Your plan does not allow this');
    }
  });

  it('maps 404 to NOT_FOUND', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(404, { message: 'Not found' }));
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/releases/999');
    if (!isOk(r)) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('passes through a server code on 409', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(409, { error: { code: 'IDEMPOTENCY_IN_FLIGHT', message: 'in flight' } }),
    );
    const r = await makeClient(fetchFn as unknown as typeof fetch).post(
      '/releases',
      {},
      { idempotency: true },
    );
    if (!isOk(r)) expect(r.error.code).toBe('IDEMPOTENCY_IN_FLIGHT');
  });

  it('maps 422 to VALIDATION_FAILED with errors and errors_structured passthrough', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(422, {
        message: 'The given data was invalid.',
        errors: { title: ['required'] },
        errors_structured: [{ field: 'title', code: 'required' }],
      }),
    );
    const r = await makeClient(fetchFn as unknown as typeof fetch).post('/releases', {});
    if (!isOk(r)) {
      expect(r.error.code).toBe('VALIDATION_FAILED');
      expect(r.error.errors).toEqual({ title: ['required'] });
      expect(r.error.errors_structured).toEqual([{ field: 'title', code: 'required' }]);
    }
  });

  it('maps 429 to RATE_LIMITED with retry_after_seconds from Retry-After', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(429, { message: 'Too Many Requests' }, { 'Retry-After': '37' }),
    );
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/analytics/summary');
    if (!isOk(r)) {
      expect(r.error.code).toBe('RATE_LIMITED');
      expect(r.error.retry_after_seconds).toBe(37);
    }
  });

  it('maps 5xx to SERVER_ERROR', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(503, { message: 'boom' }));
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/me');
    if (!isOk(r)) expect(r.error.code).toBe('SERVER_ERROR');
  });

  it('understands all four backend error body shapes', async () => {
    const shapes: Array<[unknown, string]> = [
      [{ message: 'plain message' }, 'plain message'],
      [{ error: 'string error' }, 'string error'],
      [{ errors: { field: ['bad'] } }, 'bad'],
      [{ error: { code: 'X_CODE', message: 'nested message' } }, 'nested message'],
    ];
    for (const [body, needle] of shapes) {
      const fetchFn = vi.fn(async () => jsonResponse(400, body));
      const r = await makeClient(fetchFn as unknown as typeof fetch).get('/x');
      expect(isOk(r)).toBe(false);
      if (!isOk(r)) {
        expect(typeof r.error.message).toBe('string');
        expect(JSON.stringify(r.error)).toContain(needle);
      }
    }
  });

  it('maps a fetch rejection to NETWORK_ERROR without throwing', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/me');
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.code).toBe('NETWORK_ERROR');
  });
});

describe('LabelGridClient HTTP methods', () => {
  it('uses the correct method for patch/put/delete', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const c = makeClient(fetchFn as unknown as typeof fetch);
    await c.patch('/labels/1', { name: 'x' });
    expect(lastInit(fetchFn).method).toBe('PATCH');
    await c.put('/releases/1/landing-config', { action_list: [] });
    expect(lastInit(fetchFn).method).toBe('PUT');
    await c.delete('/labels/1');
    expect(lastInit(fetchFn).method).toBe('DELETE');
  });

  it('supports idempotency on put', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    await makeClient(fetchFn as unknown as typeof fetch).put('/x', {}, { idempotency: true });
    expect(headerOf(lastInit(fetchFn), 'Idempotency-Key')).toBeTruthy();
  });

  it('raw() never sends the Authorization header (presigned PUT)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    await makeClient(fetchFn as unknown as typeof fetch).raw('https://s3.example/put-here', {
      method: 'PUT',
      body: 'bytes',
    });
    const init = lastInit(fetchFn);
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(init.method).toBe('PUT');
  });
});

describe('LabelGridClient.postMultipart', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-http-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sets the Blob media type from the file extension', async () => {
    const jpg = join(dir, 'cover.jpg');
    writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const fetchFn = vi.fn(async () => jsonResponse(200, { ok: true }));
    await makeClient(fetchFn as unknown as typeof fetch).postMultipart('/x', jpg, 'file');
    const form = lastInit(fetchFn).body as FormData;
    const file = form.get('file') as File;
    expect(file.type).toBe('image/jpeg');
  });
});

describe('LabelGridClient response-size bounds', () => {
  const MAX = 10_000_000;
  function fakeRes(over: { contentLength?: string; text: string }): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers(over.contentLength ? { 'Content-Length': over.contentLength } : {}),
      text: async () => over.text,
    } as unknown as Response;
  }

  it('rejects a response whose Content-Length exceeds the limit before reading', async () => {
    const fetchFn = vi.fn(async () => fakeRes({ contentLength: String(MAX + 1), text: 'small' }));
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/big');
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.code).toBe('RESPONSE_TOO_LARGE');
  });

  it('rejects a chunked response whose body exceeds the limit after reading', async () => {
    const fetchFn = vi.fn(async () => fakeRes({ text: 'x'.repeat(MAX + 1) }));
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/big');
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.code).toBe('RESPONSE_TOO_LARGE');
  });

  it('aborts a streamed body the moment it crosses the byte limit (cancels the reader)', async () => {
    const chunk = new Uint8Array(6_000_000);
    let reads = 0;
    let cancelled = false;
    const body = {
      getReader() {
        let i = 0;
        return {
          read: async () => {
            if (i < 2) {
              i += 1;
              reads += 1;
              return { done: false, value: chunk };
            }
            return { done: true, value: undefined };
          },
          cancel: async () => {
            cancelled = true;
          },
        };
      },
    };
    const res = { ok: true, status: 200, headers: new Headers(), body } as unknown as Response;
    const fetchFn = vi.fn(async () => res);
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/big');
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.code).toBe('RESPONSE_TOO_LARGE');
    // Two 6MB chunks cross the 10MB ceiling on the second read; the reader is
    // cancelled and the stream is never drained to completion (no 3rd read).
    expect(cancelled).toBe(true);
    expect(reads).toBe(2);
  });

  it('returns RESPONSE_TOO_LARGE even when cancelling the oversized stream rejects', async () => {
    const chunk = new Uint8Array(6_000_000);
    const body = {
      getReader() {
        let i = 0;
        return {
          read: async () => {
            if (i < 2) {
              i += 1;
              return { done: false, value: chunk };
            }
            return { done: true, value: undefined };
          },
          // A cancel() that rejects must not mask the size bound.
          cancel: async () => {
            throw new Error('cancel failed');
          },
        };
      },
    };
    const res = { ok: true, status: 200, headers: new Headers(), body } as unknown as Response;
    const fetchFn = vi.fn(async () => res);
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/big');
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.code).toBe('RESPONSE_TOO_LARGE');
  });

  it('rejects a multi-byte body over the BYTE limit even when under the char limit', async () => {
    // '€' is 3 UTF-8 bytes but one UTF-16 code unit: 3.4M chars = 10.2M bytes.
    // The old text.length check (3.4M < 10M) would have let this through.
    const multibyte = '€'.repeat(3_400_000);
    expect(multibyte.length).toBeLessThan(MAX);
    expect(Buffer.byteLength(multibyte, 'utf8')).toBeGreaterThan(MAX);
    const fetchFn = vi.fn(async () => fakeRes({ text: multibyte }));
    const r = await makeClient(fetchFn as unknown as typeof fetch).get('/big');
    expect(isOk(r)).toBe(false);
    if (!isOk(r)) expect(r.error.code).toBe('RESPONSE_TOO_LARGE');
  });
});

describe('request timeouts', () => {
  it('maps a timed-out API request to a structured TIMEOUT error', async () => {
    // A stub that honors the abort signal like real fetch: rejects on abort.
    const hangingFetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const client = new LabelGridClient({
      baseUrl: 'https://api.example.test/api/public',
      token: 'tok',
      fetchFn: hangingFetch,
      version: '0.0.0-test',
      timeoutMs: 25,
    });
    const result = await client.get('/me');
    expect('error' in result && result.error.code).toBe('TIMEOUT');
    expect('error' in result && result.error.message).toContain('timed out');
  });

  it('passes an abort signal to raw transfers', async () => {
    let sawSignal = false;
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;
    const client = new LabelGridClient({
      baseUrl: 'https://api.example.test/api/public',
      token: 'tok',
      fetchFn,
      version: '0.0.0-test',
    });
    await client.raw('https://storage.example.test/presigned', { method: 'PUT', body: 'x' });
    expect(sawSignal).toBe(true);
  });
});
