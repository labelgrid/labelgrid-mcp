/**
 * MCP resources: the nine reference datasets, exposed at
 * `labelgrid://reference/{type}`.
 *
 * Each read fetches the dataset via the shared client (no caching) and returns
 * JSON text. The same datasets are served by the `list_reference_data` tool,
 * which is the fallback for clients that don't surface resources — the
 * type→path map lives here as the single source for both. In setup mode the
 * resources are still registered (so introspection shows what the server
 * offers) but reads return the NOT_CONNECTED guidance JSON instead of data.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import type { LabelGridClient } from './api/http.js';
import type { Config } from './config.js';

/** The reference dataset types as a tuple, for the tool's zod enum. */
export const REFERENCE_TYPES = [
  'genres',
  'genre_categories',
  'languages',
  'contributor_roles',
  'instruments',
  'distro_outlets',
  'territories',
  'issue_definitions',
  'webhook_event_types',
] as const;

export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export const REFERENCE_DATASETS: Record<
  ReferenceType,
  { path: string; title: string; description: string }
> = {
  genres: {
    path: '/genres',
    title: 'Genres',
    description: 'Valid values for primary/secondary/tertiary genre IDs on releases.',
  },
  genre_categories: {
    path: '/genre-categories',
    title: 'Genre categories',
    description: 'The genre category groupings the genre IDs belong to.',
  },
  languages: {
    path: '/languages',
    title: 'Languages',
    description: 'Audio and metadata language codes.',
  },
  contributor_roles: {
    path: '/contributor-roles',
    title: 'Contributor roles',
    description: 'Valid role names for track contributors.',
  },
  instruments: {
    path: '/instruments',
    title: 'Instruments',
    description: 'Instrument names for contributor credits.',
  },
  distro_outlets: {
    path: '/distro-outlets',
    title: 'Distribution outlets',
    description: 'The distribution outlets/stores available to your account.',
  },
  territories: {
    path: '/territories',
    title: 'Territories',
    description: 'Country/territory codes.',
  },
  issue_definitions: {
    path: '/issue-definitions',
    title: 'Issue definitions',
    description:
      'The catalog of review issue definitions: each code’s human-readable title, description, severity and whether it blocks distribution. Issue codes are string slugs.',
  },
  webhook_event_types: {
    path: '/webhooks/event-types',
    title: 'Webhook event types',
    description:
      'Every available webhook event type, each with the schema of the payload it delivers.',
  },
};

/** The URI for one reference dataset resource. */
export function referenceUri(type: ReferenceType): string {
  return `labelgrid://reference/${type}`;
}

function asJsonText(uri: string, value: unknown): ReadResourceResult {
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Registers the nine `labelgrid://reference/{type}` resources on the server.
 * Reads fetch via the client; in setup mode they return NOT_CONNECTED guidance.
 */
export function registerReferenceResources(
  server: Pick<McpServer, 'registerResource'>,
  config: Config,
  client: LabelGridClient,
): void {
  for (const type of REFERENCE_TYPES) {
    const dataset = REFERENCE_DATASETS[type];
    const uri = referenceUri(type);
    server.registerResource(
      `reference-${type}`,
      uri,
      {
        title: dataset.title,
        description: dataset.description,
        mimeType: 'application/json',
      },
      async (): Promise<ReadResourceResult> => {
        if (config.setupMode) {
          return asJsonText(uri, {
            error: {
              code: 'NOT_CONNECTED',
              message:
                'No LabelGrid API token is configured, so this resource cannot be read yet. ' +
                'Call the `setup` tool for step-by-step instructions to connect your account.',
              status: 0,
            },
          });
        }
        const result = await client.get(dataset.path);
        return asJsonText(uri, 'data' in result ? result.data : { error: result.error });
      },
    );
  }
}
