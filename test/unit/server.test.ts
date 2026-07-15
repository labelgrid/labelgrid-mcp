import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { buildServer } from '../../src/server.js';
import { allTools } from '../../src/tools/all.js';
import { identityTools } from '../../src/tools/identity.js';
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

async function harness(cfg: Config, fetchFn: typeof fetch) {
  const apiClient = new LabelGridClient({
    baseUrl: cfg.baseUrl,
    token: cfg.token,
    fetchFn,
    version: '0.0.0-test',
  });
  const server = buildServer(cfg, apiClient, identityTools);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => await client.close() };
}

const openHarnesses: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openHarnesses.length > 0) {
    const close = openHarnesses.pop();
    if (close) await close();
  }
  vi.restoreAllMocks();
});

async function connect(cfg: Config, fetchFn: typeof fetch) {
  const h = await harness(cfg, fetchFn);
  openHarnesses.push(h.close);
  return h.client;
}

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

describe('buildServer registration', () => {
  it('always lists get_me and includes revoke_api_token when writes are on', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(config({ writes: true }), fetchFn as unknown as typeof fetch);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_me');
    expect(names).toContain('revoke_api_token');
  });

  it('hides revoke_api_token when writes are off but still lists get_me', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(config({ writes: false }), fetchFn as unknown as typeof fetch);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('get_me');
    expect(names).not.toContain('revoke_api_token');
  });

  it('marks get_me as read-only in its annotations', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connect(config(), fetchFn as unknown as typeof fetch);
    const { tools } = await client.listTools();
    const getMe = tools.find((t) => t.name === 'get_me');
    expect(getMe?.annotations?.readOnlyHint).toBe(true);
  });
});

describe('buildServer tool invocation', () => {
  it('returns the JSON payload from a successful get_me call', async () => {
    const account = { id: 8675309, name: 'sandbox account' };
    const fetchFn = vi.fn(async () => jsonResponse(200, account));
    const client = await connect(config(), fetchFn as unknown as typeof fetch);
    const result = await client.callTool({ name: 'get_me', arguments: {} });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual(account);
  });

  it('returns an isError result carrying TOKEN_INVALID on a 401', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { message: 'Unauthenticated.' }));
    const client = await connect(config(), fetchFn as unknown as typeof fetch);
    const result = await client.callTool({ name: 'get_me', arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('TOKEN_INVALID');
  });

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

  it('lists the setup tool plus the full inert catalog', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      setupCfg(),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    // The setup helper leads, and the whole catalog is visible to introspection
    // (write gates do not hide tools here — nothing can execute without a token).
    expect(names).toContain('setup');
    expect(names).toContain('get_me');
    expect(names).toContain('create_release');
    expect(names).toContain('distribute_release');
    expect(names.length).toBeGreaterThan(80);
  });

  it('catalog tools refuse with setup guidance and never touch the network', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(
      setupCfg(),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    for (const name of ['get_me', 'distribute_release']) {
      const result = await client.callTool({
        name,
        arguments: name === 'get_me' ? {} : { release_id: 1 },
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
      config({ setupMode: true, token: null, writes: false, toolsets: new Set(['identity']) }),
      fetchFn as unknown as typeof fetch,
      allTools(),
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('setup');
    expect(names).toContain('get_me');
    expect(names).not.toContain('create_release');
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
    toolset: 'identity',
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

  it('keeps the server working for subsequent calls after a handler throws', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const client = await connectWithTools(config(), fetchFn as unknown as typeof fetch, [
      throwingTool,
      ...identityTools,
    ]);
    await client.callTool({ name: 'boom', arguments: {} });
    const ok = await client.callTool({ name: 'get_me', arguments: {} });
    expect(ok.isError).toBeFalsy();
  });
});
