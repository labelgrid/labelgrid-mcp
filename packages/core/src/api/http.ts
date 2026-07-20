/**
 * The single typed HTTP client for the LabelGrid public API.
 *
 * Every tool goes through this client. It owns transport, header injection,
 * query serialization, optional idempotency keys and — critically — error
 * normalization: HTTP failures are turned into a structured {@link ApiError}
 * and returned, never thrown. Business rules live server-side; this file is
 * transport only (no retries, no queues).
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { contentType } from './content-types.js';

/** Hard ceiling on a single response body, in bytes/characters. */
const MAX_RESPONSE_BYTES = 10_000_000;

export type ApiError = {
  code: string;
  message: string;
  status: number;
  field?: string;
  suggestion?: string;
  retry_after_seconds?: number;
  errors?: unknown;
  /** Structured validation detail passed through verbatim from the API (422). */
  errors_structured?: unknown;
};

export type ApiResult<T = unknown> = { data: T } | { error: ApiError };

type RequestOpts = {
  query?: Record<string, unknown>;
  body?: unknown;
  idempotency?: boolean;
  /** A caller-supplied idempotency key; when absent a fresh UUID is generated. */
  idempotencyKey?: string;
};

const TOKEN_SUGGESTION =
  'Check LABELGRID_API_TOKEN — create a new token in your dashboard under Profile → API Tokens.';

/**
 * Serializes a query object into a URL search string, supporting nested
 * `filter[label_id]=5` objects and repeated `metrics[]=a&metrics[]=b` arrays.
 * Null/undefined values are skipped. Bracket structure is kept literal; only
 * key names and values are percent-encoded.
 */
function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return '';
  const parts: string[] = [];
  const push = (rawKey: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    parts.push(`${rawKey}=${encodeURIComponent(String(value))}`);
  };
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const ek = encodeURIComponent(key);
    if (Array.isArray(value)) {
      for (const item of value) push(`${ek}[]`, item);
    } else if (typeof value === 'object') {
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        const esk = encodeURIComponent(subKey);
        if (Array.isArray(subValue)) {
          for (const item of subValue) push(`${ek}[${esk}][]`, item);
        } else {
          push(`${ek}[${esk}]`, subValue);
        }
      }
    } else {
      push(ek, value);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

type ServerErrorParts = {
  code?: string;
  message?: string;
  field?: string;
  errors?: unknown;
  errors_structured?: unknown;
};

/**
 * Extracts a code/message/errors triple from any of the four backend error body
 * shapes: `{message}`, `{error: string}`, `{errors}`, `{error: {code, message}}`.
 */
function extractServerError(body: unknown): ServerErrorParts {
  if (typeof body === 'string') {
    return { message: body };
  }
  if (body === null || typeof body !== 'object') {
    return {};
  }
  const record = body as Record<string, unknown>;
  const errors = record.errors;
  const errorsStructured = record.errors_structured;

  // Shape: { error: { code, message } }
  if (record.error !== null && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    return {
      code: typeof nested.code === 'string' ? nested.code : undefined,
      message:
        typeof nested.message === 'string'
          ? nested.message
          : typeof nested.error === 'string'
            ? nested.error
            : undefined,
      errors,
      errors_structured: errorsStructured,
    };
  }
  // Shape: { error: 'string' }
  if (typeof record.error === 'string') {
    return {
      code: typeof record.code === 'string' ? record.code : undefined,
      message: record.error,
      errors,
      errors_structured: errorsStructured,
    };
  }
  // Shapes: { message } and/or { errors } and/or top-level { code }
  const parts: ServerErrorParts = {
    code: typeof record.code === 'string' ? record.code : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    field: typeof record.field === 'string' ? record.field : undefined,
    errors,
    errors_structured: errorsStructured,
  };
  // Derive a message from the first validation error when none was given.
  if (parts.message === undefined && errors !== null && typeof errors === 'object') {
    const first = Object.values(errors as Record<string, unknown>)[0];
    if (Array.isArray(first) && typeof first[0] === 'string') {
      parts.message = first[0];
    } else if (typeof first === 'string') {
      parts.message = first;
    }
  }
  return parts;
}

function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get('Retry-After');
  if (raw === null) return undefined;
  const seconds = Number.parseInt(raw, 10);
  return Number.isNaN(seconds) ? undefined : seconds;
}

/** Normalizes a non-2xx HTTP response into a structured {@link ApiError}. */
function normalizeError(res: Response, body: unknown): ApiError {
  const server = extractServerError(body);
  const status = res.status;
  const withCommon = (code: string, message: string, extra: Partial<ApiError> = {}): ApiError => ({
    code,
    message,
    status,
    ...(server.field !== undefined ? { field: server.field } : {}),
    ...(server.errors !== undefined ? { errors: server.errors } : {}),
    ...extra,
  });

  switch (status) {
    case 401:
      return withCommon('TOKEN_INVALID', server.message ?? 'Your API token was rejected.', {
        suggestion: TOKEN_SUGGESTION,
      });
    case 403:
      return withCommon(server.code ?? 'FORBIDDEN', server.message ?? 'Forbidden.');
    case 404:
      return withCommon('NOT_FOUND', server.message ?? 'The requested resource was not found.');
    case 409:
      return withCommon(
        server.code ?? 'CONFLICT',
        server.message ?? 'The request conflicts with the current state.',
      );
    case 422:
      return withCommon('VALIDATION_FAILED', server.message ?? 'The submitted data was invalid.', {
        ...(server.errors_structured !== undefined
          ? { errors_structured: server.errors_structured }
          : {}),
      });
    case 429: {
      const retryAfter = parseRetryAfter(res);
      return withCommon('RATE_LIMITED', server.message ?? 'Rate limit exceeded.', {
        ...(retryAfter !== undefined ? { retry_after_seconds: retryAfter } : {}),
      });
    }
    default:
      if (status >= 500) {
        return withCommon('SERVER_ERROR', server.message ?? 'The server encountered an error.');
      }
      return withCommon(
        server.code ?? 'ERROR',
        server.message ?? `Request failed with status ${status}.`,
      );
  }
}

export class LabelGridClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly version: string;
  private readonly timeoutMs: number;
  private readonly rawTimeoutMs: number;

  constructor(opts: {
    baseUrl: string;
    token: string;
    fetchFn?: typeof fetch;
    version: string;
    /** API request timeout (default 60s) — a hung call must never hang a tool. */
    timeoutMs?: number;
    /** Timeout for raw transfers like presigned uploads (default 10min). */
    rawTimeoutMs?: number;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.version = opts.version;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.rawTimeoutMs = opts.rawTimeoutMs ?? 600_000;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'User-Agent': `labelgrid-mcp/${this.version}`,
    };
  }

  private async send<T>(
    method: string,
    path: string,
    opts: RequestOpts & { headers?: Record<string, string>; rawBody?: BodyInit } = {},
  ): Promise<ApiResult<T>> {
    const url = `${this.baseUrl}${path}${buildQuery(opts.query)}`;
    const headers: Record<string, string> = { ...this.authHeaders(), ...opts.headers };
    if (opts.idempotency) {
      // A caller-supplied key is used verbatim (so a caller can dedupe a retry
      // across separate tool calls); otherwise a fresh UUID is generated.
      headers['Idempotency-Key'] = opts.idempotencyKey ?? randomUUID();
    }
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(this.timeoutMs) };
    if (opts.rawBody !== undefined) {
      init.body = opts.rawBody;
    } else if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await this.fetchFn(url, init);
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === 'TimeoutError' || err.name === 'AbortError')
      ) {
        return {
          error: {
            code: 'TIMEOUT',
            message: `The request timed out after ${Math.round(this.timeoutMs / 1000)} seconds. Try again, or narrow the request.`,
            status: 0,
          },
        };
      }
      return {
        error: {
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'Network request failed.',
          status: 0,
        },
      };
    }

    // Cheap pre-check: bound the response before reading when the length is known.
    const declaredLength = Number.parseInt(res.headers.get('Content-Length') ?? '', 10);
    if (!Number.isNaN(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      return {
        error: {
          code: 'RESPONSE_TOO_LARGE',
          message: `The response is ${declaredLength} bytes, over the ${MAX_RESPONSE_BYTES}-byte limit. Narrow the request with pagination or filters.`,
          status: res.status,
        },
      };
    }

    const tooLarge: ApiResult<T> = {
      error: {
        code: 'RESPONSE_TOO_LARGE',
        message: `The response body exceeds the ${MAX_RESPONSE_BYTES}-byte limit. Narrow the request with pagination or filters.`,
        status: res.status,
      },
    };

    // A chunked/streamed response carries no Content-Length, so bound it AS we
    // read: accumulate chunks with a running byte counter and abort the moment
    // the counter crosses the ceiling — never buffering the whole oversized body.
    // The request timeout keeps running while the body streams, so a read can
    // also abort here — map that to the same structured TIMEOUT.
    let text: string | { error: ApiError };
    try {
      text = await this.readBody(res, tooLarge as { error: ApiError });
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === 'TimeoutError' || err.name === 'AbortError')
      ) {
        return {
          error: {
            code: 'TIMEOUT',
            message: `The request timed out after ${Math.round(this.timeoutMs / 1000)} seconds while reading the response. Try again, or narrow the request.`,
            status: 0,
          },
        };
      }
      return {
        error: {
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'Reading the response failed.',
          status: 0,
        },
      };
    }
    if (typeof text !== 'string') {
      return text; // the bounded reader returned the too-large error result
    }
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (res.ok) {
      return { data: body as T };
    }
    return { error: normalizeError(res, body) };
  }

  /**
   * Reads a response body with the byte ceiling enforced mid-stream. Returns
   * the decoded text, or the supplied too-large error result when the ceiling
   * is crossed. Abort/timeout rejections propagate to the caller for mapping.
   */
  private async readBody(
    res: Response,
    tooLarge: { error: ApiError },
  ): Promise<string | { error: ApiError }> {
    if (res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_RESPONSE_BYTES) {
            // cancel() can reject (e.g. an already-errored stream); swallow it so
            // an oversized response ALWAYS returns RESPONSE_TOO_LARGE.
            try {
              await reader.cancel();
            } catch {
              // best-effort cleanup — the size bound is what matters here.
            }
            return tooLarge;
          }
          chunks.push(value);
        }
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder('utf-8').decode(merged);
    }
    // No readable stream (some test stubs) — fall back to text() and measure
    // the true byte length as a backstop (multi-byte chars exceed char count).
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      return tooLarge;
    }
    return text;
  }

  get<T>(path: string, query?: Record<string, unknown>): Promise<ApiResult<T>> {
    return this.send<T>('GET', path, { query });
  }

  post<T>(
    path: string,
    body?: unknown,
    opts?: { idempotency?: boolean; idempotencyKey?: string },
  ): Promise<ApiResult<T>> {
    return this.send<T>('POST', path, {
      body,
      idempotency: opts?.idempotency,
      idempotencyKey: opts?.idempotencyKey,
    });
  }

  patch<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
    return this.send<T>('PATCH', path, { body });
  }

  put<T>(
    path: string,
    body?: unknown,
    opts?: { idempotency?: boolean; idempotencyKey?: string },
  ): Promise<ApiResult<T>> {
    return this.send<T>('PUT', path, {
      body,
      idempotency: opts?.idempotency,
      idempotencyKey: opts?.idempotencyKey,
    });
  }

  delete<T>(path: string): Promise<ApiResult<T>> {
    return this.send<T>('DELETE', path);
  }

  /**
   * Sends a multipart/form-data POST with a single file field plus optional
   * extra string fields. A missing/unreadable file yields a FILE_NOT_FOUND
   * error result rather than throwing.
   */
  async postMultipart<T>(
    path: string,
    filePath: string,
    fieldName: string,
    extra?: Record<string, string>,
  ): Promise<ApiResult<T>> {
    let bytes: Buffer;
    try {
      bytes = await readFile(filePath);
    } catch (err) {
      return {
        error: {
          code: 'FILE_NOT_FOUND',
          message: `Could not read file at ${filePath}: ${err instanceof Error ? err.message : 'unknown error'}`,
          status: 0,
        },
      };
    }
    const form = new FormData();
    form.append(
      fieldName,
      new Blob([new Uint8Array(bytes)], { type: contentType(filePath) }),
      basename(filePath),
    );
    for (const [key, value] of Object.entries(extra ?? {})) {
      form.append(key, value);
    }
    // Let fetch set the multipart Content-Type boundary; do not override it.
    return this.send<T>('POST', path, { rawBody: form });
  }

  /**
   * Performs a raw request with NO Authorization header — used for presigned
   * upload PUTs, where the signed URL is already the credential and an extra
   * Bearer token would break the signature.
   */
  raw(url: string, init: RequestInit): Promise<Response> {
    return this.fetchFn(url, { signal: AbortSignal.timeout(this.rawTimeoutMs), ...init });
  }
}
