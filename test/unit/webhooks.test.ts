import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import type { ToolContext, ToolDef } from '../../src/tools/types.js';
import { webhookTools } from '../../src/tools/webhooks.js';

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
  const t = webhookTools.find((x) => x.name === name);
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

describe('webhook toolset shape', () => {
  it('exports the consolidated read + manage pair, both in the webhooks toolset', () => {
    expect(webhookTools.map((t) => t.name)).toEqual(['list_webhooks', 'manage_webhook']);
    for (const t of webhookTools) expect(t.toolset).toBe('webhooks');
    expect(byName('list_webhooks').gate).toBe('read');
    expect(byName('list_webhooks').annotations.readOnlyHint).toBe(true);
    expect(byName('manage_webhook').gate).toBe('safe_write');
    // Coarse hint: the worst action (delete / rotate_secret) sets the tone.
    expect(byName('manage_webhook').annotations.destructiveHint).toBe(true);
  });
});

describe('list_webhooks', () => {
  it('defaults to view=config: no id → GET /webhooks', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_webhooks').handler({}, ctx);
    expect(lastInit(fetchFn).method).toBe('GET');
    expect(lastUrl(fetchFn)).toContain('/webhooks');
    expect(lastUrl(fetchFn)).not.toContain('/logs');
  });

  it('view=config with webhook_id → GET /webhooks/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_webhooks').handler({ view: 'config', webhook_id: 3 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/webhooks/3');
    expect(lastUrl(fetchFn)).not.toContain('/logs');
  });

  it('view=logs with webhook_id → GET /webhooks/{id}/logs', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_webhooks').handler({ view: 'logs', webhook_id: 3 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/webhooks/3/logs');
  });

  it('view=logs without webhook_id → INVALID_SELECTOR naming webhook_id, no HTTP call', async () => {
    const { fetchFn, ctx } = harness();
    const r = await byName('list_webhooks').handler({ view: 'logs' }, ctx);
    expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
    expect('error' in r && r.error.message).toContain('webhook_id');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects an unknown view via its zod enum', () => {
    const schema = z.object(byName('list_webhooks').inputShape);
    expect(schema.safeParse({ view: 'events' }).success).toBe(false);
    expect(schema.safeParse({ view: 'logs', webhook_id: 1 }).success).toBe(true);
  });
});

describe('manage_webhook', () => {
  it('action=create → POST /webhooks with the fields body (no webhook_id needed)', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_webhook').handler(
      {
        action: 'create',
        fields: {
          name: 'my hook',
          url: 'https://example.com/hook',
          events: { 'release.distributed': true },
        },
      },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/webhooks');
    expect(lastBody(fetchFn)).toEqual({
      name: 'my hook',
      url: 'https://example.com/hook',
      events: { 'release.distributed': true },
    });
  });

  it('action=update → PATCH /webhooks/{id} with only the supplied fields', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_webhook').handler(
      { action: 'update', webhook_id: 3, fields: { is_active: false } },
      ctx,
    );
    expect(lastInit(fetchFn).method).toBe('PATCH');
    expect(lastUrl(fetchFn)).toContain('/webhooks/3');
    expect(lastBody(fetchFn)).toEqual({ is_active: false });
  });

  it('action=delete → DELETE /webhooks/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_webhook').handler({ action: 'delete', webhook_id: 3 }, ctx);
    expect(lastInit(fetchFn).method).toBe('DELETE');
    expect(lastUrl(fetchFn)).toContain('/webhooks/3');
  });

  it('action=test → POST /webhooks/{id}/test', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_webhook').handler({ action: 'test', webhook_id: 3 }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/webhooks/3/test');
  });

  it('action=rotate_secret → POST /webhooks/{id}/regenerate-secret', async () => {
    const { fetchFn, ctx } = harness();
    await byName('manage_webhook').handler({ action: 'rotate_secret', webhook_id: 3 }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/webhooks/3/regenerate-secret');
  });

  it('every action except create requires webhook_id → INVALID_SELECTOR, no HTTP call', async () => {
    for (const action of ['update', 'delete', 'test', 'rotate_secret']) {
      const { fetchFn, ctx } = harness();
      const r = await byName('manage_webhook').handler({ action }, ctx);
      expect('error' in r && r.error.code).toBe('INVALID_SELECTOR');
      expect('error' in r && r.error.message).toContain('webhook_id');
      expect(fetchFn).not.toHaveBeenCalled();
    }
  });

  it('rejects an unknown action via its zod enum', () => {
    const schema = z.object(byName('manage_webhook').inputShape);
    expect(schema.safeParse({ action: 'pause' }).success).toBe(false);
    expect(schema.safeParse({ action: 'create' }).success).toBe(true);
  });

  it('warns that a rotated secret kills the old one immediately', () => {
    expect(byName('manage_webhook').description).toContain('old secret stops working immediately');
  });
});
