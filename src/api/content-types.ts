/**
 * Shared file content-type inference and the upload extension allow-list guard.
 *
 * CONTENT_TYPES (moved here from upload.ts) infers a best-effort MIME type from
 * a file extension — used for the presigned PUT and the multipart Blob.
 * assertAllowedExtension is the per-tool guard: each file-accepting tool
 * declares exactly which extensions it accepts, and the guard rejects anything
 * else BEFORE the file is read or any HTTP call is made, so an upload tool can
 * never be pointed at an arbitrary local file.
 */

import { realpathSync } from 'node:fs';
import { extname } from 'node:path';
import type { ApiError } from './http.js';

/** Best-effort Content-Type inferred from a file extension. */
export const CONTENT_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.mp3': 'audio/mpeg',
  '.lrc': 'text/plain',
  '.txt': 'text/plain',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

/** Best-effort Content-Type for a file path (default application/octet-stream). */
export function contentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Rejects a file whose extension is not in `allowed` (case-insensitive), before
 * any read or HTTP call, and resolves the path to its real target. The supplied
 * path's extension is checked first (the fast path); then the path is resolved
 * with realpathSync and the REAL target's extension is checked too, so a symlink
 * named `cover.jpg` that points at an arbitrary local file cannot slip past the
 * guard. On success it returns `{ realPath }` — the resolved canonical path,
 * which the caller MUST use as the path it reads/uploads (never the original
 * argument), so a symlink retargeted after validation cannot redirect the read
 * (the resolved target is what gets uploaded). On failure it returns `{ error }`
 * — a structured FILE_TYPE_NOT_ALLOWED, or FILE_NOT_FOUND if the path does not
 * resolve.
 */
export function assertAllowedExtension(
  filePath: string,
  allowed: string[],
): { error: ApiError } | { realPath: string } {
  const isAllowed = (candidate: string): boolean =>
    allowed.some((a) => a.toLowerCase() === candidate);
  const ext = extname(filePath).toLowerCase();
  // Fast path: reject a plainly-disallowed extension before touching the disk.
  if (!isAllowed(ext)) {
    return {
      error: {
        code: 'FILE_TYPE_NOT_ALLOWED',
        message: `This tool only accepts ${allowed.join(', ')} files (got "${ext || 'no extension'}").`,
        status: 0,
      },
    };
  }
  // The supplied name is allowed; resolve symlinks and re-check the real target.
  let realPath: string;
  try {
    realPath = realpathSync(filePath);
  } catch {
    return {
      error: {
        code: 'FILE_NOT_FOUND',
        message: `No readable file at ${filePath}.`,
        status: 0,
      },
    };
  }
  const realExt = extname(realPath).toLowerCase();
  if (!isAllowed(realExt)) {
    return {
      error: {
        code: 'FILE_TYPE_NOT_ALLOWED',
        message: `The file resolves to a "${realExt || 'no extension'}" file; this tool only accepts ${allowed.join(', ')}.`,
        status: 0,
      },
    };
  }
  return { realPath };
}
