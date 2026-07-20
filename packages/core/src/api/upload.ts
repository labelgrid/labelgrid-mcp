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
 */

import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { log } from '../log.js';
import { contentType } from './content-types.js';
import type { ApiError, ApiResult, LabelGridClient } from './http.js';

/** True only for an existing regular file. */
function isReadableFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

type UploadUrlResponse = { upload_url?: unknown; key?: unknown };

export type UploadOptions = {
  /** The endpoint that mints the presigned URL, e.g. /tracks/42/files/stereo/upload-url. */
  uploadUrlPath: string;
  /** The endpoint that records the finalized file, e.g. /tracks/42/files/stereo. */
  commitPath: string;
  /** Absolute or relative local path to the file to upload. */
  filePath: string;
};

export async function uploadViaPresignedUrl(
  client: LabelGridClient,
  opts: UploadOptions,
): Promise<ApiResult<unknown>> {
  // Fail fast and locally: never touch the network for a file we cannot read.
  if (!isReadableFile(opts.filePath)) {
    const error: ApiError = {
      code: 'FILE_NOT_FOUND',
      message: `No readable file at ${opts.filePath}.`,
      status: 0,
    };
    return { error };
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
  // The file passed isReadableFile above, but it can vanish before this read
  // (a TOCTOU race); a structured FILE_NOT_FOUND is the contract, not a throw.
  let bytes: Buffer;
  try {
    bytes = await readFile(opts.filePath);
  } catch {
    const error: ApiError = {
      code: 'FILE_NOT_FOUND',
      message: `The file at ${opts.filePath} could not be read.`,
      status: 0,
    };
    return { error };
  }
  let putRes: Response;
  try {
    putRes = await client.raw(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType(opts.filePath) },
      body: new Uint8Array(bytes),
    });
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
