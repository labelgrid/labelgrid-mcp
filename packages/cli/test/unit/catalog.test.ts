import { describe, expect, it } from 'vitest';
import { run } from '../helpers.js';

describe('catalog search/get', () => {
  it('search routes to the entity collection with verbatim filters and paging', async () => {
    const r = await run([
      'catalog',
      'search',
      '--type',
      'release',
      '--filter',
      'label_id=5',
      '--filter',
      'is_live=1',
      '--page',
      '2',
      '--per-page',
      '50',
    ]);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'get',
        args: ['/releases', { page: '2', per_page: '50', filter: { label_id: '5', is_live: '1' } }],
      },
    ]);
  });

  it('search without filters omits the filter object', async () => {
    const r = await run(['catalog', 'search', '--type', 'label']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'get',
        args: ['/labels', { page: undefined, per_page: undefined, filter: undefined }],
      },
    ]);
  });

  it('a malformed --filter pair is a usage error (exit 2)', async () => {
    const r = await run(['catalog', 'search', '--type', 'label', '--filter', 'nopair']);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
  });

  it('get routes to the entity item endpoint', async () => {
    const r = await run(['catalog', 'get', '7', '--type', 'track']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'get', args: ['/tracks/7', undefined] }]);
  });

  it('an unknown --type is a usage error (exit 2)', async () => {
    const r = await run(['catalog', 'get', '7', '--type', 'playlist']);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
  });
});

describe('catalog create/update', () => {
  it('create posts the JSON fields to the collection (no idempotency for labels)', async () => {
    const r = await run(['catalog', 'create', '--type', 'label', '--fields', '{"name":"X"}']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'post', args: ['/labels', { name: 'X' }, undefined] }]);
  });

  it('release/track creates carry the idempotency option', async () => {
    const r = await run([
      'catalog',
      'create',
      '--type',
      'release',
      '--fields',
      '{"cat":"C1"}',
      '--idempotency-key',
      'retry-key-1',
    ]);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([
      {
        method: 'post',
        args: ['/releases', { cat: 'C1' }, { idempotency: true, idempotencyKey: 'retry-key-1' }],
      },
    ]);
  });

  it('create with invalid JSON is a usage error (exit 2)', async () => {
    const r = await run(['catalog', 'create', '--type', 'label', '--fields', '{nope']);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
  });

  it('create without --fields or --fields-file is a usage error (exit 2)', async () => {
    const r = await run(['catalog', 'create', '--type', 'label']);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
  });

  it('update patches the item endpoint', async () => {
    const r = await run([
      'catalog',
      'update',
      '9',
      '--type',
      'artist',
      '--fields',
      '{"artist_name":"Y"}',
    ]);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'patch', args: ['/artists/9', { artist_name: 'Y' }] }]);
  });
});

describe('catalog delete (destructive)', () => {
  it('is blocked without --yes when the confirmation is declined', async () => {
    const r = await run(['catalog', 'delete', '3', '--type', 'artist'], { answer: 'n' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Aborted');
    expect(r.calls).toHaveLength(0);
  });

  it('proceeds with --yes', async () => {
    const r = await run(['catalog', 'delete', '3', '--type', 'artist', '--yes']);
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([{ method: 'delete', args: ['/artists/3'] }]);
  });
});

describe('track alias guidance', () => {
  it('points at the catalog group and exits 0 without any API call', async () => {
    const r = await run(['track']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('catalog');
    expect(r.stdout).toContain('--type track');
    expect(r.calls).toHaveLength(0);
  });
});
