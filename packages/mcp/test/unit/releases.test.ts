import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LabelGridClient } from '@labelgrid/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Config } from '../../src/config.js';
import { COVERAGE, PENDING_DOCS } from '../../src/coverage.js';
import { releaseTools } from '../../src/tools/releases.js';
import { toToolResult } from '../../src/tools/types.js';
import type { ToolContext, ToolDef } from '../../src/tools/types.js';

function harness(payload: unknown = { ok: true }, status = 200) {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  const client = new LabelGridClient({
    baseUrl: 'https://api.example.test/api/public',
    token: 'tok',
    fetchFn: fetchFn as unknown as typeof fetch,
    version: 't',
  });
  const config: Config = {
    baseUrl: 'https://api.example.test/api/public',
    token: 'tok',
    setupMode: false,
    writes: true,
    fullWrites: true,
    toolsets: null,
  };
  return { fetchFn, ctx: { client, config } as ToolContext };
}
function byName(name: string): ToolDef {
  const t = releaseTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function lastInit(fetchFn: ReturnType<typeof vi.fn>): RequestInit {
  return fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit;
}
function lastBody(fetchFn: ReturnType<typeof vi.fn>): unknown {
  const b = lastInit(fetchFn).body;
  return typeof b === 'string' ? JSON.parse(b) : b;
}
function header(fetchFn: ReturnType<typeof vi.fn>, name: string): string | undefined {
  return (lastInit(fetchFn).headers as Record<string, string>)[name];
}

describe('releases toolset shape', () => {
  it('exports the seven consolidated release tools with the contracted gates', () => {
    expect(releaseTools.map((t) => t.name)).toEqual([
      'get_release_review',
      'get_delivery_queue',
      'get_release_profile_protection',
      'get_landing_config',
      'list_track_licenses',
      'run_release_checks',
      'manage_release_links',
      'add_review_issue_note',
      'upload_review_document',
    ]);
    for (const t of releaseTools) expect(t.toolset).toBe('releases');
    expect(byName('upload_review_document').gate).toBe('full_write');
    expect(byName('upload_review_document').annotations).toEqual({ destructiveHint: false });
    for (const name of [
      'get_release_review',
      'get_delivery_queue',
      'get_release_profile_protection',
      'get_landing_config',
      'list_track_licenses',
    ]) {
      expect(byName(name).gate).toBe('read');
      expect(byName(name).annotations.readOnlyHint).toBe(true);
    }
    for (const name of ['run_release_checks', 'manage_release_links', 'add_review_issue_note']) {
      expect(byName(name).gate).toBe('safe_write');
    }
    expect(byName('run_release_checks').annotations.idempotentHint).toBe(true);
  });
});

describe('get_release_review', () => {
  it('requires release_id and view via zod', () => {
    const schema = z.object(byName('get_release_review').inputShape);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ release_id: 1 }).success).toBe(false);
    expect(schema.safeParse({ release_id: 1, view: 'issues' }).success).toBe(true);
    expect(schema.safeParse({ release_id: 1, view: 'summary' }).success).toBe(false);
  });

  it('view=issues → GET /review-issues with release_id as a query param', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_release_review').handler({ release_id: 77, view: 'issues' }, ctx);
    expect(lastInit(fetchFn).method).toBe('GET');
    const url = lastUrl(fetchFn);
    expect(url).toContain('/review-issues');
    expect(url).toContain('release_id=77');
  });

  it('view=quality_report → GET /releases/{id}/quality-report', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_release_review').handler({ release_id: 33, view: 'quality_report' }, ctx);
    expect(lastUrl(fetchFn)).toContain('/releases/33/quality-report');
  });

  it('carries the Preflight QC add-on 403 caveat in the description', () => {
    const desc = byName('get_release_review').description;
    expect(desc).toContain('optional add-on');
    expect(desc).toContain('403');
  });

  it('projects concise by default: allowlisted issue fields + ids survive', async () => {
    const payload = {
      data: [{ id: 4, code: 'artwork_low_res', severity: 'error', internal_blob: 'x'.repeat(50) }],
    };
    const { ctx } = harness(payload);
    const r = await byName('get_release_review').handler({ release_id: 77, view: 'issues' }, ctx);
    expect('data' in r).toBe(true);
    const data = ('data' in r ? r.data : null) as Record<string, unknown>;
    expect(data._projection).toBe('concise');
    expect(data.data).toEqual([{ id: 4, code: 'artwork_low_res', severity: 'error' }]);
  });

  it("response_format='detailed' returns the verbatim response", async () => {
    const payload = { data: [{ id: 4, internal_blob: 'kept' }] };
    const { ctx } = harness(payload);
    const r = await byName('get_release_review').handler(
      { release_id: 77, view: 'issues', response_format: 'detailed' },
      ctx,
    );
    expect('data' in r && r.data).toEqual(payload);
  });
});

describe('get_release_review view documents', () => {
  const upload = {
    can_upload: false,
    blocked_reason: 'locked',
    max_documents: 50,
    max_file_bytes: 20971520,
    documents_this_round: 1,
    answerable_issue_ids: ['901'],
    answerable_issues: [{ id: '901', accepted_types: ['rights_proof'], scope: 'track' }],
  };
  function doc(id: number, trackCount: number) {
    return {
      id,
      type: 'rights_proof',
      review_issue_id: '901',
      original_filename: `proof-${id}.pdf`,
      mime_type: 'application/pdf',
      size_bytes: 1234,
      whole_release: false,
      tracks: Array.from({ length: trackCount }, (_, i) => ({
        id: 1000 + i,
        title: `A fairly long track title number ${i} for size`,
        mix_version: 'Original Mix',
      })),
      uploaded_at: '2026-11-27T10:00:00+00:00',
    };
  }

  it('→ GET /releases/{id}/review-documents', async () => {
    const { fetchFn, ctx } = harness({ data: [], upload });
    await byName('get_release_review').handler({ release_id: 55, view: 'documents' }, ctx);
    expect(lastInit(fetchFn).method).toBe('GET');
    expect(lastUrl(fetchFn)).toBe(
      'https://api.example.test/api/public/releases/55/review-documents',
    );
  });

  it('by default keeps upload whole and reduces each document tracks to track_ids', async () => {
    const { ctx } = harness({ data: [doc(7, 2)], upload });
    const r = await byName('get_release_review').handler(
      { release_id: 55, view: 'documents' },
      ctx,
    );
    expect('data' in r).toBe(true);
    const data = ('data' in r ? r.data : null) as Record<string, unknown>;
    expect(data.upload).toEqual(upload);
    expect(data._projection).toBeUndefined();
    const docs = data.data as Array<Record<string, unknown>>;
    expect(docs[0].track_ids).toEqual([1000, 1001]);
    expect(docs[0].tracks).toBeUndefined();
    expect(docs[0].id).toBe(7);
    expect(docs[0].review_issue_id).toBe('901');
    expect(docs[0].original_filename).toBe('proof-7.pdf');
  });

  it('keeps 50 documents of 200 tracks each a normal result with upload present', async () => {
    const payload = { data: Array.from({ length: 50 }, (_, i) => doc(i + 1, 200)), upload };
    const { ctx } = harness(payload);
    const r = await byName('get_release_review').handler(
      { release_id: 55, view: 'documents' },
      ctx,
    );
    const result = toToolResult(r);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(parsed.upload).toEqual(upload);
    expect((parsed.data as unknown[]).length).toBe(50);
  });
});

describe('get_release_review view document_download', () => {
  it('without review_document_id → INVALID_SELECTOR and no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('get_release_review').handler(
      { release_id: 55, view: 'document_download' },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
    expect('error' in r && r.error.message).toContain('review_document_id');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('with an id → GET …/review-documents/{id}/download, the link returned as sent', async () => {
    const link = {
      download_url: 'https://files.example.test/doc.pdf?sig=abc',
      filename: 'proof.pdf',
      expires_at: '2026-11-28T10:20:00+00:00',
    };
    const { fetchFn, ctx } = harness(link);
    const r = await byName('get_release_review').handler(
      { release_id: 55, view: 'document_download', review_document_id: 7 },
      ctx,
    );
    expect(lastUrl(fetchFn)).toBe(
      'https://api.example.test/api/public/releases/55/review-documents/7/download',
    );
    expect('data' in r && r.data).toEqual(link);
  });

  it('accepts review_document_id only as a positive integer (documents list ids as numbers)', () => {
    const schema = z.object(byName('get_release_review').inputShape);
    const base = { release_id: 1, view: 'document_download' };
    expect(schema.safeParse({ ...base, review_document_id: 7 }).success).toBe(true);
    expect(schema.safeParse({ ...base, review_document_id: '7/../x' }).success).toBe(false);
    expect(schema.safeParse({ ...base, review_document_id: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...base, review_document_id: 1.5 }).success).toBe(false);
  });

  it('describes the documents views and the scope of response_format', () => {
    const desc = byName('get_release_review').description;
    expect(desc).toContain('documents');
    expect(desc).toContain('document_download');
    expect(desc.toLowerCase()).toContain('without');
    expect(desc).toMatch(/response_format/);
  });
});

describe('upload_review_document', () => {
  let dir: string;
  let pdf: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lgmcp-review-doc-'));
    pdf = join(dir, 'rights.pdf');
    writeFileSync(pdf, Buffer.from('%PDF-1.4 proof'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const KEY = 'retry-key-0001';
  const tool = () => byName('upload_review_document');
  const schema = () => z.object(tool().inputShape);

  it('POSTs the exact multipart parts and the Idempotency-Key', async () => {
    const { fetchFn, ctx } = harness({ data: { id: 3 } }, 201);
    const r = await tool().handler(
      {
        release_id: 55,
        file_path: pdf,
        type: 'rights_proof',
        review_issue_id: '901',
        track_ids: [30, 4, 30, 12],
        idempotency_key: KEY,
      },
      ctx,
    );
    expect('data' in r).toBe(true);
    const init = lastInit(fetchFn);
    expect(init.method).toBe('POST');
    expect(lastUrl(fetchFn)).toBe(
      'https://api.example.test/api/public/releases/55/review-documents',
    );
    expect(header(fetchFn, 'Idempotency-Key')).toBe(KEY);
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual([
      'file',
      'type',
      'review_issue_id',
      'track_ids[]',
      'track_ids[]',
      'track_ids[]',
    ]);
    expect((form.get('file') as File).name).toBe('rights.pdf');
    expect((form.get('file') as File).type).toBe('application/pdf');
    expect(form.get('type')).toBe('rights_proof');
    expect(form.get('review_issue_id')).toBe('901');
    expect(form.getAll('track_ids[]')).toEqual(['4', '12', '30']);
  });

  it('sends a general upload (no review_issue_id, no track_ids) as file and type only', async () => {
    const { fetchFn, ctx } = harness({ data: { id: 4 } }, 201);
    await tool().handler(
      { release_id: 55, file_path: pdf, type: 'split_sheet', idempotency_key: KEY },
      ctx,
    );
    const form = lastInit(fetchFn).body as FormData;
    expect([...form.keys()]).toEqual(['file', 'type']);
  });

  it('accepts a string review_issue_id taken from a list response and sends it unchanged', async () => {
    const listed = { answerable_issue_ids: ['123456789012'] };
    const args = {
      release_id: 55,
      file_path: pdf,
      type: 'artist_authorization',
      review_issue_id: listed.answerable_issue_ids[0],
      idempotency_key: KEY,
    };
    expect(schema().safeParse(args).success).toBe(true);
    const { fetchFn, ctx } = harness({ data: { id: 5 } }, 201);
    await tool().handler(args, ctx);
    expect((lastInit(fetchFn).body as FormData).get('review_issue_id')).toBe('123456789012');
  });

  it('sends a numeric review_issue_id as its decimal string', async () => {
    const { fetchFn, ctx } = harness({ data: { id: 6 } }, 201);
    await tool().handler(
      {
        release_id: 55,
        file_path: pdf,
        type: 'rights_proof',
        review_issue_id: 901,
        idempotency_key: KEY,
      },
      ctx,
    );
    expect((lastInit(fetchFn).body as FormData).get('review_issue_id')).toBe('901');
  });

  it('accepts only safe integers as a numeric review_issue_id; a larger id goes as a string', async () => {
    const ok = { release_id: 55, file_path: pdf, type: 'rights_proof', idempotency_key: KEY };
    // JSON 9007199254740993 cannot be held exactly as a number: it is refused.
    const unsafe = JSON.parse('9007199254740993') as number;
    expect(schema().safeParse({ ...ok, review_issue_id: unsafe }).success).toBe(false);
    expect(schema().safeParse({ ...ok, review_issue_id: Number.MAX_SAFE_INTEGER }).success).toBe(
      true,
    );
    const args = { ...ok, review_issue_id: '9007199254740993' };
    expect(schema().safeParse(args).success).toBe(true);
    const { fetchFn, ctx } = harness({ data: { id: 7 } }, 201);
    await tool().handler(args, ctx);
    expect((lastInit(fetchFn).body as FormData).get('review_issue_id')).toBe('9007199254740993');
  });

  it('binds the upload to the identity of the file it checked', async () => {
    const { ctx } = harness({ data: { id: 8 } }, 201);
    const spy = vi.spyOn(ctx.client, 'postMultipart');
    await tool().handler(
      { release_id: 55, file_path: pdf, type: 'rights_proof', idempotency_key: KEY },
      ctx,
    );
    const real = realpathSync(pdf);
    const { dev, ino } = statSync(real, { bigint: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0];
    expect(call[1]).toBe(real);
    expect(call[4]).toEqual({
      idempotency: true,
      idempotencyKey: KEY,
      maxBytes: 20 * 1024 * 1024,
      expectIdentity: { dev, ino },
    });
  });

  it('validates its inputs via zod', () => {
    const ok = { release_id: 55, file_path: pdf, type: 'rights_proof', idempotency_key: KEY };
    expect(schema().safeParse(ok).success).toBe(true);
    // idempotency_key is required and well-formed.
    expect(schema().safeParse({ ...ok, idempotency_key: undefined }).success).toBe(false);
    expect(schema().safeParse({ ...ok, idempotency_key: 'short' }).success).toBe(false);
    expect(schema().safeParse({ ...ok, idempotency_key: 'has space in it' }).success).toBe(false);
    expect(schema().safeParse({ ...ok, idempotency_key: 'k'.repeat(129) }).success).toBe(false);
    expect(schema().safeParse({ ...ok, idempotency_key: 'k'.repeat(128) }).success).toBe(true);
    // type is the five-value enum.
    for (const type of [
      'ai_statement',
      'rights_proof',
      'artist_authorization',
      'split_sheet',
      'remix_authorization',
    ]) {
      expect(schema().safeParse({ ...ok, type }).success).toBe(true);
    }
    expect(schema().safeParse({ ...ok, type: 'invoice' }).success).toBe(false);
    // track_ids: 1–200 positive ids.
    expect(schema().safeParse({ ...ok, track_ids: [] }).success).toBe(false);
    expect(schema().safeParse({ ...ok, track_ids: [1] }).success).toBe(true);
    const many = Array.from({ length: 201 }, (_, i) => i + 1);
    expect(schema().safeParse({ ...ok, track_ids: many.slice(0, 200) }).success).toBe(true);
    expect(schema().safeParse({ ...ok, track_ids: many }).success).toBe(false);
    // review_issue_id: a positive decimal, as a string or a number.
    expect(schema().safeParse({ ...ok, review_issue_id: '901' }).success).toBe(true);
    expect(schema().safeParse({ ...ok, review_issue_id: 901 }).success).toBe(true);
    for (const bad of ['0', '012', '9x', '1e3', ' 9', '-1', '', 0, -3, 1.5]) {
      expect(schema().safeParse({ ...ok, review_issue_id: bad }).success).toBe(false);
    }
  });

  it('refuses a disallowed extension with no HTTP call', async () => {
    const exe = join(dir, 'proof.exe');
    writeFileSync(exe, Buffer.from([0x4d, 0x5a]));
    const { fetchFn, ctx } = harness();
    const r = await tool().handler(
      { release_id: 55, file_path: exe, type: 'rights_proof', idempotency_key: KEY },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a .pdf symlink to a disallowed file with no HTTP call', async () => {
    const target = join(dir, 'payload.sh');
    writeFileSync(target, 'echo hi');
    const link = join(dir, 'alias.pdf');
    symlinkSync(target, link);
    const { fetchFn, ctx } = harness();
    const r = await tool().handler(
      { release_id: 55, file_path: link, type: 'rights_proof', idempotency_key: KEY },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [
      422,
      { message: 'Not accepted.', error_code: 'DOCUMENT_TYPE_NOT_ACCEPTED' },
      'DOCUMENT_TYPE_NOT_ACCEPTED',
    ],
    [
      422,
      { message: 'Too large.', error_code: 'DOCUMENT_FILE_TOO_LARGE' },
      'DOCUMENT_FILE_TOO_LARGE',
    ],
    [422, { message: 'Reused.', error_code: 'idempotency_key_reused' }, 'idempotency_key_reused'],
    [
      409,
      { message: 'Processing.', error_code: 'idempotency_key_processing' },
      'idempotency_key_processing',
    ],
    [
      400,
      { message: 'Bad key.', error_code: 'invalid_idempotency_key' },
      'invalid_idempotency_key',
    ],
    [423, { message: 'Locked.', error_code: 'ENTITY_LOCKED' }, 'ENTITY_LOCKED'],
    [403, { message: 'This release cannot take documents.' }, 'FORBIDDEN'],
    [403, { message: 'Forbidden.', error_code: 'RELEASE_NOT_EDITABLE' }, 'RELEASE_NOT_EDITABLE'],
    [429, { message: 'Too many attempts.' }, 'RATE_LIMITED'],
  ])('passes a %i refusal through with its code', async (status, body, code) => {
    const { ctx } = harness(body, status);
    const r = await tool().handler(
      { release_id: 55, file_path: pdf, type: 'rights_proof', idempotency_key: KEY },
      ctx,
    );
    expect('error' in r && r.error.code).toBe(code);
    expect('error' in r && r.error.status).toBe(status);
  });

  it('describes answering a request, a general upload, the retry rule and the limits', () => {
    const desc = tool().description;
    expect(desc).toContain('review_issue_id');
    expect(desc).toContain('answerable_issues');
    expect(desc).toContain('track_ids');
    expect(desc.toLowerCase()).toContain('general');
    expect(desc.toLowerCase()).toContain('same key');
    expect(desc).toMatch(/PDF/);
    expect(desc).toContain('20 MB');
  });
});

describe('review-document coverage', () => {
  const ops = {
    'GET /releases/{release}/review-documents': 'get_release_review',
    'POST /releases/{release}/review-documents': 'upload_review_document',
    'GET /releases/{release}/review-documents/{reviewDocument}/download': 'get_release_review',
  };
  it('maps the three operations in COVERAGE and lists them as pending docs', () => {
    for (const [op, toolName] of Object.entries(ops)) {
      expect(COVERAGE[op]).toBe(toolName);
      expect(PENDING_DOCS[op]).toBe(toolName);
    }
  });
});

describe('get_delivery_queue', () => {
  it('requires release_id and rejects the retired raw-queue selectors', () => {
    const schema = z.object(byName('get_delivery_queue').inputShape).strict();
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ release_id: 21 }).success).toBe(true);
    expect(schema.safeParse({ release_id: 21, outlet_id: 4 }).success).toBe(false);
    expect(schema.safeParse({ release_id: 21, status: 'complete' }).success).toBe(false);
  });

  it('→ GET /releases/{id}/delivery-status with no raw queue query', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_delivery_queue').handler({ release_id: 21 }, ctx);
    const url = lastUrl(fetchFn);
    expect(url).toContain('/releases/21/delivery-status');
    expect(url).not.toContain('/queues/distro');
    expect(url).not.toContain('?');
  });

  it('projects the shared canonical fixture without changing its semantics', async () => {
    const payload = JSON.parse(
      readFileSync(new URL('../fixtures/delivery-status/live.json', import.meta.url), 'utf8'),
    );
    const { ctx } = harness(payload);
    const r = await byName('get_delivery_queue').handler({ release_id: 123 }, ctx);
    const data = ('data' in r ? r.data : null) as Record<string, unknown>;
    expect(data._projection).toBe('concise');
    expect(data).toEqual({ ...payload, _projection: 'concise' });
  });

  it("response_format='detailed' returns the verbatim response", async () => {
    const payload = { release_id: 1, state: 'not_submitted', outlets: [] };
    const { ctx } = harness(payload);
    const r = await byName('get_delivery_queue').handler(
      { release_id: 1, response_format: 'detailed' },
      ctx,
    );
    expect('data' in r && r.data).toEqual(payload);
  });

  it('preserves the shared canonical error fixtures', async () => {
    const fixtures = JSON.parse(
      readFileSync(new URL('../fixtures/delivery-status/errors.json', import.meta.url), 'utf8'),
    ) as Record<string, { status: number; body: Record<string, unknown> }>;

    for (const fixture of Object.values(fixtures)) {
      const { ctx } = harness(fixture.body, fixture.status);
      const result = await byName('get_delivery_queue').handler({ release_id: 123 }, ctx);

      expect(result).toEqual({
        error: {
          code: fixture.body.error_code,
          message: fixture.body.message,
          status: fixture.status,
          details: fixture.body.details,
        },
      });
    }
  });
});

describe('get_release_profile_protection', () => {
  it('→ GET /releases/{id}/profile-protection', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_release_profile_protection').handler({ release_id: 21 }, ctx);
    expect(lastInit(fetchFn).method).toBe('GET');
    expect(lastUrl(fetchFn)).toContain('/releases/21/profile-protection');
  });
});

describe('get_landing_config', () => {
  it('→ GET /releases/{id}/landing-config', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_landing_config').handler({ release_id: 21 }, ctx);
    expect(lastInit(fetchFn).method).toBe('GET');
    expect(lastUrl(fetchFn)).toContain('/releases/21/landing-config');
  });
});

describe('list_track_licenses', () => {
  it('without license_id → GET /tracks/{id}/licenses with pagination', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_track_licenses').handler({ track_id: 8, page: 1, per_page: 20 }, ctx);
    const url = lastUrl(fetchFn);
    expect(url).toContain('/tracks/8/licenses');
    expect(url).not.toContain('/licenses/');
    expect(url).toContain('per_page=20');
  });

  it('with license_id → GET /tracks/{id}/licenses/{licenseId}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_track_licenses').handler({ track_id: 8, license_id: 3 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/tracks/8/licenses/3');
  });
});

describe('run_release_checks', () => {
  it('rejects an unknown check via its zod enum', () => {
    const schema = z.object(byName('run_release_checks').inputShape);
    expect(schema.safeParse({ release_id: 1, check: 'lint' }).success).toBe(false);
    expect(schema.safeParse({ release_id: 1, check: 'validate' }).success).toBe(true);
  });

  it('check=validate → POST /releases/{id}/validate WITHOUT an auto Idempotency-Key', async () => {
    const { fetchFn, ctx } = harness();
    await byName('run_release_checks').handler({ release_id: 5, check: 'validate' }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/releases/5/validate');
    expect(header(fetchFn, 'Idempotency-Key')).toBeUndefined();
  });

  it('check=refresh_quality_report → POST /releases/{id}/quality-report/refresh', async () => {
    const { fetchFn, ctx } = harness();
    await byName('run_release_checks').handler(
      { release_id: 5, check: 'refresh_quality_report' },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/releases/5/quality-report/refresh');
  });

  it('carries the near-read and hourly-budget caveats in the description', () => {
    const desc = byName('run_release_checks').description;
    expect(desc).toContain('changes nothing');
    expect(desc).toContain('hourly refresh budget');
    expect(desc).toContain('errors_structured');
  });
});

describe('manage_release_links', () => {
  it('action=update_landing_config → PUT /releases/{id}/landing-config with config as the body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_release_links').handler(
      {
        release_id: 5,
        action: 'update_landing_config',
        config: { config_mode: 'custom', actions: [{ type: 'link' }] },
      },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('PUT');
    expect(lastUrl(fetchFn)).toContain('/releases/5/landing-config');
    expect(lastBody(fetchFn)).toEqual({ config_mode: 'custom', actions: [{ type: 'link' }] });
  });

  it('action=update_landing_config without config → INVALID_SELECTOR naming config, no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('manage_release_links').handler(
      { release_id: 5, action: 'update_landing_config' },
      ctx,
    );
    expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
    expect('error' in r && r.error.message).toContain('config');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('action=create_short_url → POST /releases/short-url with release_id body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_release_links').handler(
      { release_id: 5, action: 'create_short_url' },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/releases/short-url');
    expect(lastBody(fetchFn)).toEqual({ release_id: 5 });
  });

  it('carries the v2 action-list caveat in the description', () => {
    const desc = byName('manage_release_links').description;
    expect(desc).toContain('v2');
    expect(desc).toContain('action-list');
  });
});

describe('add_review_issue_note', () => {
  it('→ POST /review-issues/{id}/notes with note body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('add_review_issue_note').handler({ review_issue_id: 12, note: 'fixed it' }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/review-issues/12/notes');
    expect(lastBody(fetchFn)).toEqual({ note: 'fixed it' });
  });
});
