import { readFileSync } from 'node:fs';
import { LabelGridClient } from '@labelgrid/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/config.js';
import { buildServer } from '../../src/server.js';
import { accountTools } from '../../src/tools/account.js';
import { allTools } from '../../src/tools/all.js';
import { releaseTools } from '../../src/tools/releases.js';
import type { ToolDef } from '../../src/tools/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function config(overrides: Partial<Config> = {}): Config {
  return {
    baseUrl: 'https://api.example.test/api/public',
    token: 'tok',
    setupMode: false,
    writes: true,
    fullWrites: false,
    toolsets: null,
    ...overrides,
  };
}

const openHarnesses: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openHarnesses.length > 0) {
    const close = openHarnesses.pop();
    if (close) await close();
  }
  vi.restoreAllMocks();
});

async function connectWithTools(cfg: Config, fetchFn: typeof fetch, tools: ToolDef[]) {
  const apiClient = new LabelGridClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    fetchFn,
    version: '0.0.0-test',
  });
  const server = buildServer(cfg, apiClient, tools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  openHarnesses.push(async () => await client.close());
  return client;
}

async function connect(cfg: Config, fetchFn: typeof fetch) {
  return connectWithTools(cfg, fetchFn, accountTools);
}

describe('buildServer registration', () => {
  it('always lists get_account and includes revoke_api_token when writes are on', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(config({ writes: true }), fetchFn as unknown as typeof fetch);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_account');
    expect(names).toContain('revoke_api_token');
  });

  it('hides revoke_api_token when writes are off but still lists get_account', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(config({ writes: false }), fetchFn as unknown as typeof fetch);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_account');
    expect(names).not.toContain('revoke_api_token');
  });

  it('marks get_account as read-only in its annotations', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(config(), fetchFn as unknown as typeof fetch);
    const { tools } = await client.listTools();
    const getAccount = tools.find((t) => t.name === 'get_account');
    expect(getAccount?.annotations?.readOnlyHint).toBe(true);
  });
});

describe('buildServer default connected surface', () => {
  it('exposes EXACTLY 24 tools by default (no webhooks, no full writes)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(config(), fetchFn as unknown as typeof fetch, allTools());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toHaveLength(24);
    // Webhooks are default-off; full writes are unarmed.
    expect(names).not.toContain('list_webhooks');
    expect(names).not.toContain('manage_webhook');
    expect(names).not.toContain('distribute_release');
    expect(names).not.toContain('upload_asset');
    // The consolidated families are present.
    expect(names).toContain('get_account');
    expect(names).toContain('search_catalog');
    expect(names).toContain('get_release_review');
    expect(names).toContain('query_financials');
  });

  it('exposes the webhook pair when LABELGRID_TOOLSETS names webhooks', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      config({ toolsets: new Set(['webhooks']) }),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['list_webhooks', 'manage_webhook']);
  });

  it('exposes all 33 tools when every toolset is named and full writes are armed', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      config({
        fullWrites: true,
        toolsets: new Set([
          'account',
          'reference',
          'catalog',
          'releases',
          'insights',
          'finance',
          'webhooks',
          'distribution',
        ]),
      }),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(33);
  });

  it('registers the nine reference resources', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(config(), fetchFn as unknown as typeof fetch, allTools());
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(9);
    for (const r of resources) {
      expect(r.uri).toMatch(/^labelgrid:\/\/reference\//);
    }
  });
});

describe('buildServer reference resources honor the toolset gate', () => {
  it('registers the nine resources when reference is named explicitly', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      config({ toolsets: new Set(['reference']) }),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(9);
  });

  it('registers no reference resources when an explicit selection omits reference', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      config({ toolsets: new Set(['account']) }),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    // Reference disabled → nothing registered, so the server never advertises
    // the resources capability and resources/list is effectively empty.
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
  });

  it('setup mode (default toolsets) still registers the nine resources, but inert', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      config({ setupMode: true, token: null, writes: false }),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(9);
    // Inert: a read returns NOT_CONNECTED guidance and never touches the network.
    const read = await client.readResource({ uri: 'labelgrid://reference/genres' });
    const body = JSON.parse((read.contents[0] as { text: string }).text) as {
      error?: { code?: string };
    };
    expect(body.error?.code).toBe('NOT_CONNECTED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('setup mode with an explicit selection omitting reference registers no resources', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      config({ setupMode: true, token: null, writes: false, toolsets: new Set(['account']) }),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
  });
});

describe('buildServer tool invocation', () => {
  it('returns the JSON payload from a successful get_account call', async () => {
    const account = { id: 8675309, name: 'sandbox account' };
    const fetchFn = vi.fn(async () => jsonResponse(200, account));
    const client = await connect(config(), fetchFn as unknown as typeof fetch);
    const result = await client.callTool({ name: 'get_account', arguments: { view: 'profile' } });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual(account);
    expect(result.structuredContent).toBeUndefined();
  });

  it('returns an isError result carrying TOKEN_INVALID on a 401', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { message: 'Unauthenticated.' }));
    const client = await connect(config(), fetchFn as unknown as typeof fetch);
    const result = await client.callTool({ name: 'get_account', arguments: { view: 'profile' } });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('TOKEN_INVALID');
  });

  it.each([200, 400])(
    'returns bounded JSON for an oversized HTTP %i response without replay',
    async (status) => {
      const huge = '"\\\u0000'.repeat(500_000);
      const fetchFn = vi.fn(async () =>
        jsonResponse(status, status === 200 ? { blob: huge } : { message: huge }),
      );
      const client = await connect(config(), fetchFn as unknown as typeof fetch);
      const result = await client.callTool({
        name: 'revoke_api_token',
        arguments: { token_id: 123 },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text.length).toBeLessThanOrEqual(400_000);
      const parsed = JSON.parse(text);
      if (status === 200) {
        expect(parsed.error.code).toBe('RESULT_TOO_LARGE');
        expect(parsed.error.suggestion).toContain('may already have completed');
        expect(parsed.error.suggestion).toContain('before retrying');
      } else {
        expect(parsed.error.status).toBe(400);
        expect(parsed.error.message).toContain('[truncated]');
      }
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it('errors when calling a gated-off tool and never invokes its handler', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(config({ writes: false }), fetchFn as unknown as typeof fetch);
    // A tool that failed the gate is not registered: the SDK returns an
    // isError result ("Tool not found"), and the handler (and thus fetch) never runs.
    const result = await client.callTool({ name: 'revoke_api_token', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('not found');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('delivery-status output contract', () => {
  const live = JSON.parse(
    readFileSync(new URL('../fixtures/delivery-status/live.json', import.meta.url), 'utf8'),
  );

  it('advertises an object schema only for the opted-in delivery tool', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, live));
    const client = await connectWithTools(config(), fetchFn, allTools());
    const { tools } = await client.listTools();
    const typedTools = tools.filter((tool) => tool.outputSchema);
    expect(typedTools.map((tool) => tool.name)).toEqual(['get_delivery_queue']);
    expect(typedTools[0].outputSchema).toMatchObject({
      type: 'object',
      additionalProperties: true,
      required: [
        'release_id',
        'state',
        'currently_live',
        'ever_submitted',
        'ever_delivered',
        'outlets',
      ],
      properties: {
        outlets: {
          type: 'array',
          items: {
            additionalProperties: true,
            required: expect.arrayContaining([
              'attention_owner',
              'customer_action_code',
              'action_url',
            ]),
          },
        },
      },
    });
  });

  const removed = {
    ...live,
    state: 'removed',
    currently_live: false,
    outlets: [
      { ...live.outlets[0], state: 'removed', customer_state: 'removed', operation: 'takedown' },
    ],
  };
  const notSubmitted = {
    ...live,
    state: 'not_submitted',
    currently_live: false,
    ever_submitted: false,
    ever_delivered: false,
    outlets: [],
  };
  const actionNeeded = {
    ...live,
    state: 'action_needed',
    currently_live: false,
    outlets: [
      {
        ...live.outlets[0],
        state: 'action_needed',
        customer_state: 'action_needed',
        attention_owner: 'customer',
        customer_action_code: 'fix_metadata',
        action_url: 'https://example.test/releases/123',
        queue_id: null,
        updated_at: null,
        error_code: 'METADATA_INVALID',
      },
    ],
  };

  describe.each(['concise', 'detailed'])('%s results', (responseFormat) => {
    it.each([
      ['live', live],
      ['removed but historically delivered', removed],
      ['not submitted with no outlets', notSubmitted],
      ['customer action with nullable queue metadata', actionNeeded],
    ])('preserves %s in matching text and structured content', async (_name, payload) => {
      const fetchFn = vi.fn(async () => jsonResponse(200, payload));
      const client = await connectWithTools(config(), fetchFn, releaseTools);
      // Also exercises the SDK client's output validator populated by tools/list.
      await client.listTools();
      const result = await client.callTool({
        name: 'get_delivery_queue',
        arguments: { release_id: 123, response_format: responseFormat },
      });
      const expected =
        responseFormat === 'concise' ? { ...payload, _projection: 'concise' } : payload;
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(expected);
      expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual(expected);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it.each([
      { ...live, currently_live: undefined },
      { ...live, currently_live: 'true' },
      { ...live, outlets: [{ ...live.outlets[0], operation: 'unknown' }] },
      { ...live, outlets: [{ ...live.outlets[0], customer_action_code: undefined }] },
    ])('refuses a response that violates the published contract', async (payload) => {
      const fetchFn = vi.fn(async () => jsonResponse(200, payload));
      const client = await connectWithTools(config(), fetchFn, releaseTools);
      await client.listTools();
      const result = await client.callTool({
        name: 'get_delivery_queue',
        arguments: { release_id: 123, response_format: responseFormat },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect((result.content as Array<{ text: string }>)[0].text).toContain(
        'Output validation error',
      );
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  it('preserves additional detailed fields without wrapping the response', async () => {
    const payload = {
      ...live,
      extra: 'additional aggregate field',
      outlets: [{ ...live.outlets[0], extra: 'additional outlet field' }],
    };
    const client = await connectWithTools(
      config(),
      vi.fn(async () => jsonResponse(200, payload)),
      releaseTools,
    );
    await client.listTools();
    const result = await client.callTool({
      name: 'get_delivery_queue',
      arguments: { release_id: 123, response_format: 'detailed' },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(payload);
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual(payload);
  });

  it.each([
    [
      404,
      { error_code: 'RELEASE_NOT_ACCESSIBLE', message: 'The release is not accessible.' },
      'RELEASE_NOT_ACCESSIBLE',
    ],
    [
      200,
      { ...live, outlets: [{ ...live.outlets[0], error_code: '"'.repeat(500_000) }] },
      'RESULT_TOO_LARGE',
    ],
    [400, { message: 'x'.repeat(500_000) }, 'ERROR'],
  ])(
    'keeps HTTP %i failures as bounded errors without structured success',
    async (status, payload, code) => {
      const fetchFn = vi.fn(async () => jsonResponse(status, payload));
      const client = await connectWithTools(config(), fetchFn, releaseTools);
      await client.listTools();
      const result = await client.callTool({
        name: 'get_delivery_queue',
        arguments: { release_id: 123 },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text.length).toBeLessThanOrEqual(400_000);
      expect(JSON.parse(text).error.code).toBe(code);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it('returns setup guidance for the typed tool without calling the API', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, live));
    const client = await connectWithTools(
      config({ setupMode: true, token: null }),
      fetchFn,
      releaseTools,
    );
    await client.listTools();
    const result = await client.callTool({
      name: 'get_delivery_queue',
      arguments: { release_id: 123 },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text).error.code).toBe(
      'NOT_CONNECTED',
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('buildServer legal disclosure instructions', () => {
  it('carries the AS-IS legal summary in the initialize instructions', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(config(), fetchFn as unknown as typeof fetch);
    const instructions = client.getInstructions();
    expect(instructions).toBeDefined();
    expect(instructions).toContain('AS-IS');
    expect(instructions).toContain('without warranty');
    expect(instructions).toContain('Terms of Service');
  });

  it('includes the full-writes notice in instructions only when full writes are armed', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const off = await connect(config({ fullWrites: false }), fetchFn as unknown as typeof fetch);
    expect(off.getInstructions()).not.toContain('Full writes are enabled');

    const on = await connect(config({ fullWrites: true }), fetchFn as unknown as typeof fetch);
    const instructions = on.getInstructions();
    expect(instructions).toContain('Full writes are enabled');
    expect(instructions).toContain('LABELGRID_FULL_WRITES_ACK');
  });
});

describe('buildServer setup mode', () => {
  const setupCfg = () => config({ setupMode: true, token: null, writes: false });

  it('lists the setup helper plus the 31-tool default catalog (webhooks excluded)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      setupCfg(),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    // The setup helper leads, and the catalog is visible to introspection
    // (write gates do not hide tools here — nothing can execute without a
    // token). The webhooks default-off exclusion applies to the listing too,
    // so the advertised surface matches reality: 31 catalog tools + setup.
    expect(names).toContain('setup');
    expect(names).toContain('get_account');
    expect(names).toContain('create_catalog_item');
    expect(names).toContain('distribute_release');
    expect(names).not.toContain('list_webhooks');
    expect(names).not.toContain('manage_webhook');
    expect(names).toHaveLength(32);
  });

  it('lists the webhook pair in setup mode when webhooks is named explicitly', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      config({ setupMode: true, token: null, writes: false, toolsets: new Set(['webhooks']) }),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('setup');
    expect(names).toContain('list_webhooks');
    expect(names).toContain('manage_webhook');
  });

  it('catalog tools refuse with setup guidance and never touch the network', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      setupCfg(),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    for (const name of ['get_account', 'distribute_release']) {
      const result = await client.callTool({
        name,
        arguments: name === 'get_account' ? { view: 'profile' } : { release_id: 1 },
      });
      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain('NOT_CONNECTED');
      expect(text).toContain('setup');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('setup mode honors an explicit toolset narrowing in the listing', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      config({ setupMode: true, token: null, writes: false, toolsets: new Set(['account']) }),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('setup');
    expect(names).toContain('get_account');
    expect(names).not.toContain('create_catalog_item');
  });

  it('returns the connection guide without making any API call', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(setupCfg(), fetchFn as unknown as typeof fetch);
    const result = await client.callTool({ name: 'setup', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const guide = JSON.parse(content[0].text) as {
      security_note?: string;
      steps?: string[];
    };
    // The dashboard token page is named in the guide.
    expect(content[0].text).toContain('app.labelgrid.com/user/profile/api-tokens');
    // The placeholder is the only token-like content — never a real token.
    expect(content[0].text).toContain('your-token-here');
    expect(content[0].text).not.toMatch(/\blg_[A-Za-z0-9]{8,}\b/);
    expect(guide.security_note).toBeDefined();
    // No API call is ever made from setup mode.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('names the current toolsets and the webhooks opt-in in the optional settings', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(setupCfg(), fetchFn as unknown as typeof fetch);
    const result = await client.callTool({ name: 'setup', arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('account, reference, catalog, releases, insights, finance');
    expect(text).toContain('webhooks');
    expect(text).toContain('off by default');
    expect(text).toContain('aliases');
  });

  it('points the instructions at the setup tool and carries the AS-IS legal text', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(setupCfg(), fetchFn as unknown as typeof fetch);
    const instructions = client.getInstructions();
    expect(instructions).toContain('setup');
    expect(instructions).toContain('not connected');
    expect(instructions).toContain('AS-IS');
    expect(instructions).toContain('without warranty');
  });

  it('never registers the setup tool in normal mode', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(config(), fetchFn as unknown as typeof fetch);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('setup');
  });
});

describe('buildServer handler exception safety', () => {
  const throwingTool: ToolDef = {
    name: 'boom',
    toolset: 'account',
    gate: 'read',
    title: 'Boom',
    description: 'A tool whose handler throws, to exercise the wrapper safety net.',
    inputShape: {},
    annotations: { readOnlyHint: true },
    handler: async () => {
      throw new Error('kaboom internal detail');
    },
  };

  it('returns an UNEXPECTED_ERROR isError result when a handler throws', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(config(), fetchFn as unknown as typeof fetch, [
      throwingTool,
    ]);
    const result = await client.callTool({ name: 'boom', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as { error: { code: string; message: string } };
    expect(parsed.error.code).toBe('UNEXPECTED_ERROR');
    expect(parsed.error.message).toBe('kaboom internal detail');
    // The message carries no stack trace — only the error message string.
    expect(content[0].text).not.toContain('at ');
  });

  it('bounds a thrown-handler error without replaying the handler', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const handler = vi.fn(async () => {
      throw new Error('"'.repeat(500_000));
    });
    const fetchFn = vi.fn();
    const client = await connectWithTools(config(), fetchFn as unknown as typeof fetch, [
      { ...throwingTool, handler },
    ]);
    const result = await client.callTool({ name: 'boom', arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(result.isError).toBe(true);
    expect(text.length).toBeLessThanOrEqual(400_000);
    expect(JSON.parse(text).error).toMatchObject({
      code: 'UNEXPECTED_ERROR',
      status: 0,
      message: expect.stringContaining('[truncated]'),
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps the server working for subsequent calls after a handler throws', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(config(), fetchFn as unknown as typeof fetch, [
      throwingTool,
      ...accountTools,
    ]);
    await client.callTool({ name: 'boom', arguments: {} });
    const ok = await client.callTool({ name: 'get_account', arguments: { view: 'profile' } });
    expect(ok.isError).toBeFalsy();
  });
});
