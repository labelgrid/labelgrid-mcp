import { describe, expect, it, vi } from 'vitest';
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

describe('webhook toolset gates and annotations', () => {
  it('has 4 reads and 5 safe writes, all in the webhooks toolset', () => {
    expect(webhookTools.map((t) => t.name)).toEqual([
      'list_webhooks',
      'get_webhook',
      'get_webhook_logs',
      'list_webhook_event_types',
      'create_webhook',
      'update_webhook',
      'delete_webhook',
      'test_webhook',
      'rotate_webhook_secret',
    ]);
    for (const t of webhookTools) expect(t.toolset).toBe('webhooks');
    for (const name of [
      'list_webhooks',
      'get_webhook',
      'get_webhook_logs',
      'list_webhook_event_types',
    ]) {
      expect(byName(name).gate).toBe('read');
      expect(byName(name).annotations.readOnlyHint).toBe(true);
    }
    for (const name of [
      'create_webhook',
      'update_webhook',
      'delete_webhook',
      'test_webhook',
      'rotate_webhook_secret',
    ]) {
      expect(byName(name).gate).toBe('safe_write');
    }
    expect(byName('delete_webhook').annotations.destructiveHint).toBe(true);
    expect(byName('rotate_webhook_secret').annotations.destructiveHint).toBe(true);
    expect(byName('test_webhook').annotations.idempotentHint).toBe(true);
  });
});

describe('webhook read tools', () => {
  it('list_webhooks → GET /webhooks', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_webhooks').handler({}, ctx);
    expect(lastInit(fetchFn).method).toBe('GET');
    expect(lastUrl(fetchFn)).toContain('/webhooks');
  });
  it('get_webhook → GET /webhooks/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_webhook').handler({ webhook_id: 3 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/webhooks/3');
  });
  it('get_webhook_logs → GET /webhooks/{id}/logs', async () => {
    const { fetchFn, ctx } = harness();
    await byName('get_webhook_logs').handler({ webhook_id: 3 }, ctx);
    expect(lastUrl(fetchFn)).toContain('/webhooks/3/logs');
  });
  it('list_webhook_event_types → GET /webhooks/event-types', async () => {
    const { fetchFn, ctx } = harness();
    await byName('list_webhook_event_types').handler({}, ctx);
    expect(lastUrl(fetchFn)).toContain('/webhooks/event-types');
  });
});

describe('webhook write tools', () => {
  it('create_webhook → POST /webhooks with name/url/events body', async () => {
    const { fetchFn, ctx } = harness();
    await byName('create_webhook').handler(
      { name: 'my hook', url: 'https://example.com/hook', events: { 'release.distributed': true } },
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
  it('update_webhook → PATCH /webhooks/{id} with only supplied fields', async () => {
    const { fetchFn, ctx } = harness();
    await byName('update_webhook').handler({ webhook_id: 3, is_active: false }, ctx);
    expect(lastInit(fetchFn).method).toBe('PATCH');
    expect(lastUrl(fetchFn)).toContain('/webhooks/3');
    expect(lastBody(fetchFn)).toEqual({ is_active: false });
  });
  it('delete_webhook → DELETE /webhooks/{id}', async () => {
    const { fetchFn, ctx } = harness();
    await byName('delete_webhook').handler({ webhook_id: 3 }, ctx);
    expect(lastInit(fetchFn).method).toBe('DELETE');
    expect(lastUrl(fetchFn)).toContain('/webhooks/3');
  });
  it('test_webhook → POST /webhooks/{id}/test', async () => {
    const { fetchFn, ctx } = harness();
    await byName('test_webhook').handler({ webhook_id: 3 }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/webhooks/3/test');
  });
  it('rotate_webhook_secret → POST /webhooks/{id}/regenerate-secret', async () => {
    const { fetchFn, ctx } = harness();
    await byName('rotate_webhook_secret').handler({ webhook_id: 3 }, ctx);
    expect(lastInit(fetchFn).method).toBe('POST');
    expect(lastUrl(fetchFn)).toContain('/webhooks/3/regenerate-secret');
  });
});
