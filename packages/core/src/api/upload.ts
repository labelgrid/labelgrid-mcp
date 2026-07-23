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
};

function fileTooLargeError(size: number, limit: number): ApiError {
  return {
    code: 'FILE_TOO_LARGE',
    message: `The file is ${size} bytes, over the ${limit}-byte upload limit.`,
    status: 0,
  };
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
    const error: ApiError = {
      code: 'FILE_NOT_FOUND',
      message: `No readable file at ${opts.filePath}.`,
      status: 0,
    };
    return { error };
  }
  if (initialStat.size > limit) {
    return { error: fileTooLargeError(initialStat.size, limit) };
  }

  // Step 1: mint the presigned URL.
  const minted = await client.post<UploadUrlResponse>(opts.uploadUrlPath, {
    filename: basename(opts.filePath),
  });
  if ('error' in minted) return minted;
  const uploadUrl = minted.data?.upload_url;
  const key = minted.data?.key;
  if (typeof uploadUrl !== 'string' || typeof key !== 'string') {
    const error: ApiError = {
      code: 'UPLOAD_URL_INVALID',
      message: 'The upload-url response did not contain a usable upload_url and key.',
      status: 0,
    };
    return { error };
  }

  // Step 2: PUT the bytes directly to storage — NO auth header (the URL is signed).
  // The file passed the stat above, but it can vanish before this transfer (a
  // TOCTOU race); a structured FILE_NOT_FOUND is the contract, not a throw. Re-stat
  // here so Content-Length is the file's current size at the moment of upload.
  const uploadStat = statReadableFile(opts.filePath);
  if (uploadStat === null) {
    const error: ApiError = {
      code: 'FILE_NOT_FOUND',
      message: `The file at ${opts.filePath} could not be read.`,
      status: 0,
    };
    return { error };
  }
  if (uploadStat.size > limit) {
    return { error: fileTooLargeError(uploadStat.size, limit) };
  }
  let putRes: Response;
  try {
    // A stream body must declare Content-Length (a chunked PUT is rejected 411 by
    // S3-compatible storage) and requires duplex: 'half' for undici's fetch.
    const putInit = {
      method: 'PUT',
      headers: {
        'Content-Type': contentType(opts.filePath),
        'Content-Length': String(uploadStat.size),
      },
      body: createReadStream(opts.filePath),
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
    const error: ApiError = {
      code: 'UPLOAD_FAILED',
      message: 'Uploading the file to storage failed.',
      status: 0,
    };
    return { error };
  }
  if (!putRes.ok) {
    // Abort BEFORE the commit — a half-uploaded object is never finalized.
    const error: ApiError = {
      code: 'UPLOAD_FAILED',
      message: `Uploading the file to storage failed with status ${putRes.status}.`,
      status: putRes.status,
    };
    return { error };
  }

  // Step 3: commit the object key (idempotent — a retried commit will not duplicate).
  return client.put(opts.commitPath, { s3_key: key }, { idempotency: true });
}
