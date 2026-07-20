import { LabelGridClient } from '@labelgrid/core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Config } from '../../src/config.js';
import { referenceTools } from '../../src/tools/reference.js';
import type { ToolContext, ToolDef } from '../../src/tools/types.js';

function harness() {
  const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
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

function byName(tools: ToolDef[], name: string): ToolDef {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function lastInit(fetchFn: ReturnType<typeof vi.fn>): RequestInit {
  return fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit;
}

describe('list_reference_data', () => {
  const tool = byName(referenceTools, 'list_reference_data');

  it('is the only reference tool, read-only in the reference toolset', () => {
    expect(referenceTools.map((t) => t.name)).toEqual(['list_reference_data']);
    expect(tool.gate).toBe('read');
    expect(tool.toolset).toBe('reference');
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  const cases: Array<[string, string]> = [
    ['genres', '/genres'],
    ['genre_categories', '/genre-categories'],
    ['languages', '/languages'],
    ['contributor_roles', '/contributor-roles'],
    ['instruments', '/instruments'],
    ['distro_outlets', '/distro-outlets'],
    ['territories', '/territories'],
    ['issue_definitions', '/issue-definitions'],
    ['webhook_event_types', '/webhooks/event-types'],
  ];
  it('serves exactly the nine datasets', () => {
    const schema = z.object(tool.inputShape);
    for (const [type] of cases) {
      expect(schema.safeParse({ type }).success).toBe(true);
    }
  });
  for (const [type, path] of cases) {
    it(`maps type=${type} to GET ${path}`, async () => {
      const { fetchFn, ctx } = harness();
      await tool.handler({ type }, ctx);
      expect(lastInit(fetchFn).method).toBe('GET');
      expect(lastUrl(fetchFn)).toContain(path);
    });
  }

  it('rejects an unknown type via its zod enum', () => {
    const schema = z.object(tool.inputShape);
    expect(schema.safeParse({ type: 'nonsense' }).success).toBe(false);
    expect(schema.safeParse({ type: 'genres' }).success).toBe(true);
  });

  it('points clients at the MCP resources and names itself the fallback', () => {
    expect(tool.description).toContain('labelgrid://reference/{type}');
    expect(tool.description).toContain('fallback');
  });
});
