/**
 * Sandbox smoke tests.
 *
 * These run only when BOTH LABELGRID_API_TOKEN and LABELGRID_API_URL are set
 * (see the README/contract workflow); they are skipped otherwise. They read
 * the base URL and token from the environment ONLY — no hostname, token, or
 * account name is committed here, and there is deliberately no fallback to
 * the production base URL. Point them at the sandbox, never production.
 */

import { LabelGridClient } from '@labelgrid/core';
import type { ApiResult } from '@labelgrid/core';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/config.js';
import { accountTools } from '../../src/tools/account.js';
import { catalogTools } from '../../src/tools/catalog.js';
import { insightsTools } from '../../src/tools/insights.js';
import { referenceTools } from '../../src/tools/reference.js';
import type { ToolContext, ToolDef } from '../../src/tools/types.js';

const TOKEN = process.env.LABELGRID_API_TOKEN;
const BASE_URL = process.env.LABELGRID_API_URL;

function context(): ToolContext {
  const config: Config = {
    baseUrl: BASE_URL ?? '',
    token: TOKEN ?? '',
    setupMode: false,
    writes: true,
    fullWrites: false,
    toolsets: null,
  };
  const client = new LabelGridClient({
    baseUrl: config.baseUrl,
    token: config.token,
    version: 'contract',
  });
  return { client, config };
}

function tool(arr: ToolDef[], name: string): ToolDef {
  const t = arr.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

function data(r: ApiResult<unknown>): Record<string, unknown> {
  if ('error' in r) throw new Error(`expected data, got error: ${JSON.stringify(r.error)}`);
  return (r.data ?? {}) as Record<string, unknown>;
}

/** A collection response may be a bare array or a `{ data: [...] }` envelope. */
function collection(r: ApiResult<unknown>): unknown[] {
  const d = 'error' in r ? undefined : r.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object' && Array.isArray((d as { data?: unknown }).data)) {
    return (d as { data: unknown[] }).data;
  }
  return [];
}

describe.skipIf(!TOKEN || !BASE_URL)('sandbox smoke', () => {
  it('get_account (view profile) returns the authenticated account', async () => {
    const r = await tool(accountTools, 'get_account').handler({ view: 'profile' }, context());
    const account = data(r);
    // The account envelope carries an id (possibly nested under `data`).
    const id =
      account.id ?? (account.data as { id?: unknown } | undefined)?.id ?? account.account_id;
    expect(id).toBeDefined();
  });

  it('search_catalog (label) returns a paginated collection', async () => {
    const r = await tool(catalogTools, 'search_catalog').handler(
      { entity: 'label', per_page: 5 },
      context(),
    );
    expect('error' in r).toBe(false);
    expect(Array.isArray(collection(r))).toBe(true);
  });

  it('list_reference_data(genres) is non-empty', async () => {
    const r = await tool(referenceTools, 'list_reference_data').handler(
      { type: 'genres' },
      context(),
    );
    expect(collection(r).length).toBeGreaterThan(0);
  });

  it('get_analytics returns a summary envelope for a recent window', async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const r = await tool(insightsTools, 'get_analytics').handler(
      { start_date: iso(start), end_date: iso(end) },
      context(),
    );
    // A 200 envelope (possibly empty) — not an auth/validation error.
    expect('error' in r).toBe(false);
  });

  it('a missing release normalizes to NOT_FOUND', async () => {
    const r = await tool(catalogTools, 'get_catalog_item').handler(
      { entity: 'release', id: 999999999 },
      context(),
    );
    expect('error' in r && r.error.code).toBe('NOT_FOUND');
  });
});
