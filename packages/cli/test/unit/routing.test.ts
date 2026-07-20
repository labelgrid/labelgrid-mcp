/**
 * Routing checks for the remaining command groups: each command reaches the
 * right endpoint with the right args, and every destructive command is
 * confirm-gated (blocked without --yes, proceeds with it).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../helpers.js';

describe('asset delete', () => {
  it('track slots route to the track file endpoint (confirm-gated)', async () => {
    const blocked = await run(['asset', 'delete', '--track', '4', '--type', 'stereo']);
    expect(blocked.code).toBe(1);
    expect(blocked.calls).toHaveLength(0);

    const r = await run(['asset', 'delete', '--track', '4', '--type', 'stereo', '--yes']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'delete', args: ['/tracks/4/files/stereo'] }]);
  });

  it('release motion slots route to the release file endpoint', async () => {
    const r = await run(['asset', 'delete', '--release', '8', '--type', 'motion-tall', '--yes']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'delete', args: ['/releases/8/files/tall'] }]);
  });

  it('rejects a release slot on a track (exit 2)', async () => {
    const r = await run(['asset', 'delete', '--track', '4', '--type', 'motion-tall', '--yes']);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
  });
});

describe('license', () => {
  let dir: string;
  let pdfPath: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lg-cli-license-'));
    pdfPath = join(dir, 'clearance.pdf');
    writeFileSync(pdfPath, '%PDF');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('list routes to the track licenses collection', async () => {
    const r = await run(['license', 'list', '--track', '4']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: 'get', args: ['/tracks/4/licenses', { page: undefined, per_page: undefined }] },
    ]);
  });

  it('list --id retrieves one license', async () => {
    const r = await run(['license', 'list', '--track', '4', '--id', '9']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'get', args: ['/tracks/4/licenses/9', undefined] }]);
  });

  it('add uploads the file with its metadata as multipart', async () => {
    const r = await run([
      'license',
      'add',
      '--track',
      '4',
      '--file',
      pdfPath,
      '--type',
      'cover',
      '--license-id',
      'REF-1',
      '--provider',
      'licensing_agency',
    ]);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].method).toBe('postMultipart');
    expect(r.calls[0].args[0]).toBe('/tracks/4/licenses');
    expect(String(r.calls[0].args[1])).toContain('clearance.pdf');
    expect(r.calls[0].args[3]).toEqual({
      type: 'cover',
      license_id: 'REF-1',
      license_provider: 'licensing_agency',
    });
  });

  it('add rejects a disallowed file type before any call (exit 1)', async () => {
    const badPath = join(dir, 'notes.txt');
    writeFileSync(badPath, 'hi');
    const r = await run(['license', 'add', '--track', '4', '--file', badPath]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('FILE_TYPE_NOT_ALLOWED');
    expect(r.calls).toHaveLength(0);
  });

  it('update replaces the file on an existing license', async () => {
    const r = await run(['license', 'update', '--track', '4', '--id', '9', '--file', pdfPath]);
    expect(r.code).toBe(0);
    expect(r.calls[0].method).toBe('postMultipart');
    expect(r.calls[0].args[0]).toBe('/tracks/4/licenses/9');
  });

  it('delete is confirm-gated', async () => {
    const blocked = await run(['license', 'delete', '--track', '4', '--id', '9']);
    expect(blocked.code).toBe(1);
    expect(blocked.calls).toHaveLength(0);

    const r = await run(['license', 'delete', '--track', '4', '--id', '9', '--yes']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'delete', args: ['/tracks/4/licenses/9'] }]);
  });
});

describe('statement / transactions', () => {
  it('statement list forwards filters and grouping', async () => {
    const r = await run(['statement', 'list', '--filter', 'label_id=5', '--group-by', 'release']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'get',
        args: [
          '/statements',
          { group_by: 'release', page: undefined, per_page: undefined, filter: { label_id: '5' } },
        ],
      },
    ]);
  });

  it('statement get routes by invoice number', async () => {
    const r = await run(['statement', 'get', 'INV-42']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'get', args: ['/statements/INV-42', undefined] }]);
  });

  it('transactions list forwards sort and filters', async () => {
    const r = await run(['transactions', 'list', '--sort', '-date', '--filter', 'isrc=X1']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'get',
        args: [
          '/transactions',
          {
            group_by: undefined,
            sort: '-date',
            page: undefined,
            per_page: undefined,
            filter: { isrc: 'X1' },
          },
        ],
      },
    ]);
  });
});

describe('royalties', () => {
  it('breakdown forwards group_by and cursor', async () => {
    const r = await run(['royalties', 'breakdown', '--group-by', 'release,dsp', '--cursor', 'c1']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'get',
        args: [
          '/royalties/breakdown',
          { group_by: 'release,dsp', per_page: undefined, cursor: 'c1', filter: undefined },
        ],
      },
    ]);
  });

  it('artificial-streams passes filters as top-level query params', async () => {
    const r = await run(['royalties', 'artificial-streams', '--filter', 'dsp=spotify']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'get',
        args: [
          '/royalties/artificial-streams',
          { dsp: 'spotify', cursor: undefined, per_page: undefined },
        ],
      },
    ]);
  });

  it('artificial-fee routes by period', async () => {
    const r = await run(['royalties', 'artificial-fee', '--period', '2026-01']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: 'get', args: ['/artificial-streaming-fee/2026-01', undefined] },
    ]);
  });

  it('artificial-fee without --period is a usage error (exit 2)', async () => {
    const r = await run(['royalties', 'artificial-fee']);
    expect(r.code).toBe(2);
  });
});

describe('analytics', () => {
  it('get sends the window as filter params and metrics as an array', async () => {
    const r = await run([
      'analytics',
      'get',
      '--start',
      '2026-06-01',
      '--end',
      '2026-06-30',
      '--metrics',
      'streams,saves',
      '--platform',
      'SPOTIFY',
    ]);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'get',
        args: [
          '/analytics/summary',
          {
            filter: {
              start_date: '2026-06-01',
              end_date: '2026-06-30',
              platform: 'SPOTIFY',
              release_id: undefined,
              isrc: undefined,
              upc: undefined,
            },
            metrics: ['streams', 'saves'],
            limit: undefined,
          },
        ],
      },
    ]);
  });

  it('get without --start is a usage error (exit 2)', async () => {
    const r = await run(['analytics', 'get', '--end', '2026-06-30']);
    expect(r.code).toBe(2);
  });
});

describe('webhook', () => {
  it('list / get / logs route to the webhook reads', async () => {
    expect((await run(['webhook', 'list'])).calls).toEqual([
      { method: 'get', args: ['/webhooks', undefined] },
    ]);
    expect((await run(['webhook', 'get', '5'])).calls).toEqual([
      { method: 'get', args: ['/webhooks/5', undefined] },
    ]);
    expect((await run(['webhook', 'logs', '5'])).calls).toEqual([
      { method: 'get', args: ['/webhooks/5/logs', undefined] },
    ]);
  });

  it('create posts the fields payload', async () => {
    const r = await run([
      'webhook',
      'create',
      '--fields',
      '{"name":"n","url":"https://h.example.test","events":{}}',
    ]);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'post',
        args: ['/webhooks', { name: 'n', url: 'https://h.example.test', events: {} }, undefined],
      },
    ]);
  });

  it('update patches the fields payload', async () => {
    const r = await run(['webhook', 'update', '5', '--fields', '{"is_active":false}']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'patch', args: ['/webhooks/5', { is_active: false }] }]);
  });

  it('test posts to the test endpoint without confirmation', async () => {
    const r = await run(['webhook', 'test', '5']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'post', args: ['/webhooks/5/test', undefined, undefined] }]);
  });

  it('delete and rotate-secret are confirm-gated', async () => {
    expect((await run(['webhook', 'delete', '5'])).calls).toHaveLength(0);
    expect((await run(['webhook', 'delete', '5'])).code).toBe(1);
    expect((await run(['webhook', 'delete', '5', '--yes'])).calls).toEqual([
      { method: 'delete', args: ['/webhooks/5'] },
    ]);

    expect((await run(['webhook', 'rotate-secret', '5'])).calls).toHaveLength(0);
    expect((await run(['webhook', 'rotate-secret', '5', '--yes'])).calls).toEqual([
      { method: 'post', args: ['/webhooks/5/regenerate-secret', undefined, undefined] },
    ]);
  });
});

describe('review', () => {
  it('issues lists the review issues for a release', async () => {
    const r = await run(['review', 'issues', '--release', '12']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'get', args: ['/review-issues', { release_id: '12' }] }]);
  });

  it('quality-report reads the report (no refresh by default)', async () => {
    const r = await run(['review', 'quality-report', '--release', '12']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'get', args: ['/releases/12/quality-report', undefined] }]);
  });

  it('quality-report --refresh re-runs the checks first', async () => {
    const r = await run(['review', 'quality-report', '--release', '12', '--refresh']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: 'post', args: ['/releases/12/quality-report/refresh', undefined, undefined] },
      { method: 'get', args: ['/releases/12/quality-report', undefined] },
    ]);
  });

  it('note posts to the review-issue notes endpoint', async () => {
    const r = await run(['review', 'note', '--issue', '77', '--text', 'fixed the split']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: 'post', args: ['/review-issues/77/notes', { note: 'fixed the split' }, undefined] },
    ]);
  });
});

describe('beatport enable', () => {
  it('is confirm-gated and routes to the label endpoint', async () => {
    const blocked = await run(['beatport', 'enable', '--label', '3']);
    expect(blocked.code).toBe(1);
    expect(blocked.calls).toHaveLength(0);

    const r = await run(['beatport', 'enable', '--label', '3', '--yes']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      { method: 'post', args: ['/labels/3/enable-beatport', undefined, undefined] },
    ]);
  });
});
