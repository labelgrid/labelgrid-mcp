import { LabelGridClient } from '@labelgrid/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/config.js';
import {
  REFERENCE_DATASETS,
  REFERENCE_TYPES,
  referenceUri,
  registerReferenceResources,
} from '../../src/resources.js';

type Registered = {
  name: string;
  uri: string;
  config: { title: string; description: string; mimeType: string };
  read: () => Promise<{ contents: Array<{ uri: string; mimeType?: string; text: string }> }>;
};

function harness(overrides: Partial<Config> = {}) {
  const fetchFn = vi.fn(
    async () => new Response(JSON.stringify([{ id: 1, name: 'House' }]), { status: 200 }),
  );
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
    fullWrites: false,
    toolsets: null,
    ...overrides,
  };
  const calls: Registered[] = [];
  const server = {
    registerResource: vi.fn(
      (name: string, uri: string, cfg: Registered['config'], cb: Registered['read']) => {
        calls.push({ name, uri, config: cfg, read: cb });
      },
    ),
  } as unknown as Pick<McpServer, 'registerResource'>;
  return { fetchFn, client, config, server, calls };
}

describe('reference dataset map', () => {
  it('declares exactly the nine datasets with their endpoint paths', () => {
    expect([...REFERENCE_TYPES]).toEqual([
      'genres',
      'genre_categories',
      'languages',
      'contributor_roles',
      'instruments',
      'distro_outlets',
      'territories',
      'issue_definitions',
      'webhook_event_types',
    ]);
    expect(REFERENCE_DATASETS.genres.path).toBe('/genres');
    expect(REFERENCE_DATASETS.genre_categories.path).toBe('/genre-categories');
    expect(REFERENCE_DATASETS.languages.path).toBe('/languages');
    expect(REFERENCE_DATASETS.contributor_roles.path).toBe('/contributor-roles');
    expect(REFERENCE_DATASETS.instruments.path).toBe('/instruments');
    expect(REFERENCE_DATASETS.distro_outlets.path).toBe('/distro-outlets');
    expect(REFERENCE_DATASETS.territories.path).toBe('/territories');
    expect(REFERENCE_DATASETS.issue_definitions.path).toBe('/issue-definitions');
    expect(REFERENCE_DATASETS.webhook_event_types.path).toBe('/webhooks/event-types');
  });

  it('builds labelgrid://reference/{type} URIs', () => {
    expect(referenceUri('genres')).toBe('labelgrid://reference/genres');
    expect(referenceUri('webhook_event_types')).toBe('labelgrid://reference/webhook_event_types');
  });
});

describe('registerReferenceResources', () => {
  it('registers all nine resources with JSON mime type and the reference URI scheme', () => {
    const { server, client, config, calls } = harness();
    registerReferenceResources(server, config, client);
    expect(calls).toHaveLength(9);
    const uris = calls.map((c) => c.uri).sort();
    expect(uris).toEqual([...REFERENCE_TYPES].map((t) => `labelgrid://reference/${t}`).sort());
    for (const c of calls) {
      expect(c.config.mimeType).toBe('application/json');
      expect(c.config.title.length).toBeGreaterThan(0);
      expect(c.config.description.length).toBeGreaterThan(0);
      expect(c.name.startsWith('reference-')).toBe(true);
    }
  });

  it('a read fetches the dataset via the client and returns JSON text', async () => {
    const { server, client, config, calls, fetchFn } = harness();
    registerReferenceResources(server, config, client);
    const genres = calls.find((c) => c.uri === 'labelgrid://reference/genres');
    if (!genres) throw new Error('genres resource not registered');
    const result = await genres.read();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toContain('/genres');
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe('labelgrid://reference/genres');
    expect(result.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(result.contents[0].text)).toEqual([{ id: 1, name: 'House' }]);
  });

  it('an API error read returns the structured error as JSON text, never throws', async () => {
    const { server, client, config, calls } = harness();
    const failFetch = vi.fn(
      async () => new Response(JSON.stringify({ message: 'down' }), { status: 500 }),
    );
    const failing = new LabelGridClient({
      baseUrl: 'https://api.example.test/api/public',
      token: 'tok',
      fetchFn: failFetch as unknown as typeof fetch,
      version: 't',
    });
    registerReferenceResources(server, config, failing);
    const territories = calls.find((c) => c.uri === 'labelgrid://reference/territories');
    if (!territories) throw new Error('territories resource not registered');
    const result = await territories.read();
    const body = JSON.parse(result.contents[0].text);
    expect(body.error.code).toBe('SERVER_ERROR');
    expect(body.error.status).toBe(500);
  });

  it('setup mode: resources are registered but reads return NOT_CONNECTED guidance', async () => {
    const { server, client, calls, fetchFn } = harness();
    const config: Config = {
      baseUrl: 'https://api.example.test/api/public',
      token: null,
      setupMode: true,
      writes: false,
      fullWrites: false,
      toolsets: null,
    };
    registerReferenceResources(server, config, client);
    expect(calls).toHaveLength(9);
    const genres = calls.find((c) => c.uri === 'labelgrid://reference/genres');
    if (!genres) throw new Error('genres resource not registered');
    const result = await genres.read();
    expect(fetchFn).not.toHaveBeenCalled();
    const body = JSON.parse(result.contents[0].text);
    expect(body.error.code).toBe('NOT_CONNECTED');
    expect(body.error.message).toContain('setup');
  });
});
