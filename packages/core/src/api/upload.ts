/**
 * Presigned-URL upload helper.
 *
 * A large binary asset is never streamed through the LabelGrid API. Instead the
 * flow is three steps:
 *   1. POST the upload-url endpoint (with the filename) to mint a short-lived
 *      presigned storage URL and its object key.
 *   2. PUT the file bytes straight to that presigned URL. This request carries
 *      NO Authorization header — the signature in the URL is the credential, and
 *      an extra Bearer token would break it.
 *   3. PUT the commit endpoint with the returned object key (with an idempotency
 *      key) so the API records the finalized file.
 *
 * A failure at step 2 aborts before the commit, so a half-uploaded object is
 * never finalized. Business rules (format checks, transcoding) stay server-side.
 *
 * The step-2 PUT streams the file from disk rather than buffering it whole: the
 * request body is a read stream and the object's byte size is sent as an
 * explicit Content-Length. (An S3-compatible presigned PUT rejects a chunked
 * Transfer-Encoding body with 411 MissingContentLength, and fetch defaults a
 * stream body to chunked, so the header is mandatory.) This keeps peak memory
 * flat regardless of file size.
 */

import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { Transform } from 'node:stream';
import { log } from '../log.js';
import { contentType } from './content-types.js';
import type { ApiError, ApiResult, LabelGridClient } from './http.js';

/** Hard ceiling on a single uploaded file, in bytes (4 GiB). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

/** Stats a path, returning its size only for an existing regular file. */
function statReadableFile(p: string): { size: number } | null {
  try {
    const st = statSync(p);
    return st.isFile() ? { size: st.size } : null;
  } catch {
    return null;
  }
}

type UploadUrlResponse = { upload_url?: unknown; key?: unknown };

/**
 * The structural subset of {@link LabelGridClient} the presigned-upload flow
 * needs. Declared as a Pick so any object with these methods (including a test
 * stub) can drive the flow — a class type would demand the private fields too.
 */
export type UploadHttp = Pick<LabelGridClient, 'post' | 'put' | 'raw'>;

export type UploadOptions = {
  /** The endpoint that mints the presigned URL, e.g. /tracks/42/files/stereo/upload-url. */
  uploadUrlPath: string;
  /** The endpoint that records the finalized file, e.g. /tracks/42/files/stereo. */
  commitPath: string;
  /** Absolute or relative local path to the file to upload. */
  filePath: string;
  /** Byte ceiling override (defaults to {@link MAX_UPLOAD_BYTES}); for tests. */
  maxBytes?: number;
  /** Called with the running byte count as the upload streams (for a progress UI). */
  onProgress?: (bytesSoFar: number) => void;
};

function fileTooLargeError(size: number, limit: number): ApiError {
  return {
    code: 'FILE_TOO_LARGE',
    message: `The file is ${size} bytes, over the ${limit}-byte upload limit.`,
    status: 0,
  };
}

/**
 * THE SEAM: the presigned flow is three independently-callable steps —
 * {@link mintUpload} (get a signed URL + key), {@link putToPresignedUrl} (send
 * the bytes), {@link commitUpload} (record the object) — and
 * {@link uploadViaPresignedUrl} just composes them. An alternate transport that
 * does the PUT out of process (e.g. a browser or a worker doing the byte
 * transfer directly) can reuse mint + commit and swap only the middle step,
 * without reimplementing the URL-minting or commit contracts.
 */

/** The result of minting a presigned URL: the signed URL + object key, or an error. */
export type MintResult = { uploadUrl: string; key: string } | { error: ApiError };

/** Step 1: mint the presigned URL + object key for `filename`. */
export async function mintUpload(
  client: Pick<UploadHttp, 'post'>,
  uploadUrlPath: string,
  filename: string,
): Promise<MintResult> {
  const minted = await client.post<UploadUrlResponse>(uploadUrlPath, { filename });
  if ('error' in minted) return { error: minted.error };
  const uploadUrl = minted.data?.upload_url;
  const key = minted.data?.key;
  if (typeof uploadUrl !== 'string' || typeof key !== 'string') {
    return {
      error: {
        code: 'UPLOAD_URL_INVALID',
        message: 'The upload-url response did not contain a usable upload_url and key.',
        status: 0,
      },
    };
  }
  return { uploadUrl, key };
}

/**
 * Step 2: stream the file's bytes to the presigned URL — NO auth header (the URL
 * is signed). Re-stats the file so Content-Length is its size at upload time,
 * enforcing the byte ceiling and the FILE_NOT_FOUND (TOCTOU) contract there.
 * Returns null on success, or a structured error.
 */
export async function putToPresignedUrl(
  client: Pick<UploadHttp, 'raw'>,
  uploadUrl: string,
  filePath: string,
  maxBytes: number = MAX_UPLOAD_BYTES,
  onProgress?: (bytesSoFar: number) => void,
): Promise<ApiError | null> {
  // The file may vanish between an earlier stat and this transfer (a TOCTOU
  // race); a structured FILE_NOT_FOUND is the contract, not a throw.
  const stat = statReadableFile(filePath);
  if (stat === null) {
    return {
      code: 'FILE_NOT_FOUND',
      message: `The file at ${filePath} could not be read.`,
      status: 0,
    };
  }
  if (stat.size > maxBytes) return fileTooLargeError(stat.size, maxBytes);
  let putRes: Response;
  try {
    // A stream body must declare Content-Length (a chunked PUT is rejected 411 by
    // S3-compatible storage) and requires duplex: 'half' for undici's fetch.
    let body: NodeJS.ReadableStream = createReadStream(filePath);
    if (onProgress !== undefined) {
      // Count bytes as they pass through, inside the Transform (never a 'data'
      // listener, which would flip the stream to flowing mode and race the reader).
      let transferred = 0;
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb): void {
          transferred += chunk.length;
          onProgress(transferred);
          cb(null, chunk);
        },
      });
      (body as NodeJS.ReadableStream).pipe(counter);
      body = counter;
    }
    const putInit = {
      method: 'PUT',
      headers: {
        'Content-Type': contentType(filePath),
        'Content-Length': String(stat.size),
      },
      body,
      duplex: 'half',
    } as unknown as RequestInit;
    putRes = await client.raw(uploadUrl, putInit);
  } catch (err) {
    // Never surface err.message raw to the log — it can embed the signed URL,
    // and `reason` is not a redacted key. Strip any URL before logging.
    log('error', 'presigned upload PUT failed', {
      reason:
        err instanceof Error ? err.message.replace(/https?:\/\/\S+/gi, '[url]') : 'network error',
    });
    return { code: 'UPLOAD_FAILED', message: 'Uploading the file to storage failed.', status: 0 };
  }
  if (!putRes.ok) {
    return {
      code: 'UPLOAD_FAILED',
      message: `Uploading the file to storage failed with status ${putRes.status}.`,
      status: putRes.status,
    };
  }
  return null;
}

/** Step 3: commit the uploaded object key (idempotent — a retried commit will not duplicate). */
export function commitUpload(
  client: Pick<UploadHttp, 'put'>,
  commitPath: string,
  key: string,
): Promise<ApiResult<unknown>> {
  return client.put(commitPath, { s3_key: key }, { idempotency: true });
}

export async function uploadViaPresignedUrl(
  client: UploadHttp,
  opts: UploadOptions,
): Promise<ApiResult<unknown>> {
  const limit = opts.maxBytes ?? MAX_UPLOAD_BYTES;

  // Fail fast and locally: never touch the network for a file we cannot read,
  // and reject an oversized file with an honest size error (not FILE_NOT_FOUND).
  const initialStat = statReadableFile(opts.filePath);
  if (initialStat === null) {
    return {
      error: {
        code: 'FILE_NOT_FOUND',
        message: `No readable file at ${opts.filePath}.`,
        status: 0,
      },
    };
  }
  if (initialStat.size > limit) {
    return { error: fileTooLargeError(initialStat.size, limit) };
  }

  // Compose the seam: mint → PUT the bytes → commit. A failed PUT aborts before
  // the commit, so a half-uploaded object is never finalized.
  const minted = await mintUpload(client, opts.uploadUrlPath, basename(opts.filePath));
  if ('error' in minted) return { error: minted.error };
  const putError = await putToPresignedUrl(
    client,
    minted.uploadUrl,
    opts.filePath,
    limit,
    opts.onProgress,
  );
  if (putError !== null) return { error: putError };
  return commitUpload(client, opts.commitPath, minted.key);
}
