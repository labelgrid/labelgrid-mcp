import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { accountTools } from '../../src/tools/account.js';
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
function byName(name: string): ToolDef {
  const t = accountTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}
function lastUrl(fetchFn: ReturnType<typeof vi.fn>): string {
  return decodeURIComponent(String(fetchFn.mock.calls[fetchFn.mock.calls.length - 1][0]));
}
function lastMethod(fetchFn: ReturnType<typeof vi.fn>): string | undefined {
  return (fetchFn.mock.calls[fetchFn.mock.calls.length - 1][1] as RequestInit).method;
}

describe('account toolset shape', () => {
  it('exports get_account and revoke_api_token in the account toolset', () => {
    expect(accountTools.map((t) => t.name)).toEqual(['get_account', 'revoke_api_token']);
    for (const t of accountTools) expect(t.toolset).toBe('account');
  });

  it('get_account is a read-only read; revoke_api_token a destructive+idempotent safe write', () => {
    const get = byName('get_account');
    expect(get.gate).toBe('read');
    expect(get.annotations.readOnlyHint).toBe(true);
    const revoke = byName('revoke_api_token');
    expect(revoke.gate).toBe('safe_write');
    expect(revoke.annotations.destructiveHint).toBe(true);
    expect(revoke.annotations.idempotentHint).toBe(true);
  });
});

describe('get_account view routing', () => {
  it("view='profile' → GET /me", async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_account').handler({ view: 'profile' }, ctx);
    expect(lastMethod(fetchFn)).toBe('GET');
    expect(lastUrl(fetchFn)).toContain('/me');
    expect(lastUrl(fetchFn)).not.toContain('/account');
  });

  it("view='balance' → GET /account", async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_account').handler({ view: 'balance' }, ctx);
    expect(lastMethod(fetchFn)).toBe('GET');
    expect(lastUrl(fetchFn)).toContain('/account');
  });

  it('requires view and rejects unknown views via its zod enum', () => {
    const schema = z.object(byName('get_account').inputShape);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ view: 'summary' }).success).toBe(false);
    expect(schema.safeParse({ view: 'profile' }).success).toBe(true);
    expect(schema.safeParse({ view: 'balance' }).success).toBe(true);
  });
});

describe('revoke_api_token routing', () => {
  it('without token_id → DELETE /tokens/current', async () => {
    const { fetchFn, ctx } = harness();
    await byName('revoke_api_token').handler({}, ctx);
    expect(lastMethod(fetchFn)).toBe('DELETE');
    expect(lastUrl(fetchFn)).toContain('/tokens/current');
  });

  it('with token_id → DELETE /tokens/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('revoke_api_token').handler({ token_id: 42 }, ctx);
    expect(lastMethod(fetchFn)).toBe('DELETE');
    expect(lastUrl(fetchFn)).toContain('/tokens/42');
  });

  it('warns in the description that revoking the current token ends the session', () => {
    expect(byName('revoke_api_token').description).toContain('immediately ends this session');
  });
});
