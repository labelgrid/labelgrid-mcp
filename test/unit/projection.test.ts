import { describe, expect, it } from 'vitest';
import { CONCISE_ALLOWLISTS, applyProjection, projectConcise } from '../../src/projection.js';

describe('projectConcise', () => {
  it('keeps allowlisted keys and drops everything else', () => {
    const out = projectConcise({ title: 'Night Drive', bio_full: 'long text', foo: 1 }, [
      'title',
    ]) as Record<string, unknown>;
    expect(out.title).toBe('Night Drive');
    expect(out).not.toHaveProperty('bio_full');
    expect(out).not.toHaveProperty('foo');
  });

  it('ALWAYS keeps id and any key ending _id, even when not allowlisted', () => {
    const out = projectConcise({ id: 7, label_id: 3, primary_genre_id: 12, discarded: 'x' }, [
      'title',
    ]) as Record<string, unknown>;
    expect(out.id).toBe(7);
    expect(out.label_id).toBe(3);
    expect(out.primary_genre_id).toBe(12);
    expect(out).not.toHaveProperty('discarded');
  });

  it('appends the _projection marker at the top level only', () => {
    const out = projectConcise(
      { id: 1, nested: { id: 2, junk: true }, items: [{ id: 3 }] },
      [],
    ) as Record<string, unknown>;
    expect(out._projection).toBe('concise');
    expect((out.nested as Record<string, unknown>)._projection).toBeUndefined();
    expect((out.items as Record<string, unknown>[])[0]._projection).toBeUndefined();
  });

  it('preserves meta/links pagination envelopes verbatim while filtering data rows', () => {
    const out = projectConcise(
      {
        data: [
          { id: 1, title: 'A', internal_note: 'drop me' },
          { id: 2, title: 'B', internal_note: 'drop me too' },
        ],
        links: { next: 'https://api.test/next', prev: 'https://api.test/prev' },
        meta: { current_page: 1, total: 50, per_page: 25 },
      },
      ['title'],
    ) as Record<string, unknown>;
    // Data rows are still filtered to the allowlist (+ ids).
    expect(out.data).toEqual([
      { id: 1, title: 'A' },
      { id: 2, title: 'B' },
    ]);
    // meta and links keep EVERY field verbatim — no allowlist filtering.
    expect(out.links).toEqual({ next: 'https://api.test/next', prev: 'https://api.test/prev' });
    expect(out.meta).toEqual({ current_page: 1, total: 50, per_page: 25 });
  });

  it('preserves a nested meta/links subtree verbatim at any depth', () => {
    const out = projectConcise(
      { result: { data: [{ id: 1, junk: 'x' }], meta: { total: 3, per_page: 1 } } },
      [],
    ) as Record<string, unknown>;
    const result = out.result as Record<string, unknown>;
    expect(result.data).toEqual([{ id: 1 }]);
    expect(result.meta).toEqual({ total: 3, per_page: 1 });
  });

  it('preserves top-level primitive cursor keys (next_cursor/prev_cursor/cursor)', () => {
    const out = projectConcise(
      {
        data: [{ id: 1, title: 'A', junk: 'x' }],
        next_cursor: 'abc',
        prev_cursor: 'zyx',
        cursor: 'here',
      },
      ['title'],
    ) as Record<string, unknown>;
    expect(out.next_cursor).toBe('abc');
    expect(out.prev_cursor).toBe('zyx');
    expect(out.cursor).toBe('here');
    expect(out.data).toEqual([{ id: 1, title: 'A' }]);
  });

  it('projects a top-level array element-wise without a marker', () => {
    const out = projectConcise([{ id: 1, junk: 'x' }], []) as unknown[];
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([{ id: 1 }]);
  });

  it('passes primitives and null through untouched', () => {
    expect(projectConcise(null, ['title'])).toBeNull();
    expect(projectConcise('plain', ['title'])).toBe('plain');
    expect(projectConcise(42, ['title'])).toBe(42);
  });

  it('never transforms values — kept values are verbatim', () => {
    const out = projectConcise({ title: '  spaced  ', status: 0, isrc: 'US1234500001', id: 9 }, [
      'title',
      'status',
      'isrc',
    ]) as Record<string, unknown>;
    expect(out.title).toBe('  spaced  ');
    expect(out.status).toBe(0);
    expect(out.isrc).toBe('US1234500001');
  });
});

describe('per-tool allowlists', () => {
  it('declares the catalog allowlist for search_catalog and get_catalog_item', () => {
    const expected = [
      'title',
      'name',
      'artist_name',
      'full_name',
      'status',
      'review_status',
      'is_live',
      'barcode_number',
      'cat',
      'isrc',
      'release_date',
      'created_at',
      'updated_at',
      'email',
      'ipi',
      'pro',
    ];
    expect([...CONCISE_ALLOWLISTS.search_catalog]).toEqual(expected);
    expect([...CONCISE_ALLOWLISTS.get_catalog_item]).toEqual(expected);
  });

  it('declares the other [proj] tool allowlists from the build contract', () => {
    expect([...CONCISE_ALLOWLISTS.get_release_review]).toEqual([
      'code',
      'title',
      'severity',
      'status',
      'requires_feedback',
      'message',
      'created_at',
    ]);
    expect([...CONCISE_ALLOWLISTS.get_delivery_queue]).toEqual([
      'status',
      'outlet',
      'outlet_id',
      'delivered_at',
      'created_at',
      'type',
    ]);
    expect([...CONCISE_ALLOWLISTS.query_artificial_streaming]).toEqual([
      'dsp',
      'country',
      'quantity',
      'period',
      'date',
      'status',
      'severity',
      'isrc',
      'upc',
    ]);
    expect([...CONCISE_ALLOWLISTS.query_financials]).toEqual([
      'period',
      'status',
      'currency',
      'gross_usd',
      'net_usd',
      'amount',
      'total_due_usd',
      'invoice_number',
      'transaction_type',
      'scope',
      'date_paid',
      'created_at',
    ]);
  });
});

describe('applyProjection', () => {
  const data = { id: 1, title: 'A', internal_note: 'drop' };

  it('projects when response_format is absent (concise is the default)', () => {
    const r = applyProjection({ data }, 'search_catalog', undefined);
    expect('data' in r && r.data).toEqual({ id: 1, title: 'A', _projection: 'concise' });
  });

  it("projects when response_format is 'concise'", () => {
    const r = applyProjection({ data }, 'search_catalog', 'concise');
    expect('data' in r && r.data).toEqual({ id: 1, title: 'A', _projection: 'concise' });
  });

  it("'detailed' bypasses projection and returns the verbatim response", () => {
    const r = applyProjection({ data }, 'search_catalog', 'detailed');
    expect('data' in r && r.data).toBe(data);
  });

  it('passes error results through untouched', () => {
    const error = { code: 'NOT_FOUND', message: 'nope', status: 404 };
    const r = applyProjection({ error }, 'search_catalog', undefined);
    expect('error' in r && r.error).toBe(error);
  });
});
