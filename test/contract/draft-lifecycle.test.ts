/**
 * Sandbox draft-lifecycle test.
 *
 * Drives a real draft through the API: create a release, edit it, add a track
 * (with the required recording_country), validate it, then delete the track and
 * the release. It ALWAYS cleans up what it created (afterAll), even if an
 * assertion fails partway. It discovers the label/genre/artist it needs at
 * runtime, so nothing account-specific is committed. Gated on
 * LABELGRID_API_TOKEN; runs against the sandbox only, never production.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { ApiResult } from '../../src/api/http.js';
import { LabelGridClient } from '../../src/api/http.js';
import type { Config } from '../../src/config.js';
import { catalogReadTools } from '../../src/tools/catalog-read.js';
import { referenceTools } from '../../src/tools/reference.js';
import { releaseWriteTools } from '../../src/tools/release-write.js';
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

function collection(r: ApiResult<unknown>): Array<Record<string, unknown>> {
  const d = 'error' in r ? undefined : r.data;
  if (Array.isArray(d)) return d as Array<Record<string, unknown>>;
  if (d && typeof d === 'object' && Array.isArray((d as { data?: unknown }).data)) {
    return (d as { data: Array<Record<string, unknown>> }).data;
  }
  return [];
}

/** Pulls a resource id out of a `{ data: { id } }` or `{ id }` create response. */
function resourceId(r: ApiResult<unknown>): number | undefined {
  if ('error' in r) return undefined;
  const d = r.data as { id?: unknown; data?: { id?: unknown } } | null;
  const id = d?.id ?? d?.data?.id;
  return typeof id === 'number' ? id : undefined;
}

const ids: { releaseId?: number; trackId?: number } = {};

describe.skipIf(!TOKEN)('draft lifecycle (sandbox)', () => {
  afterAll(async () => {
    const ctx = context();
    if (ids.trackId !== undefined) {
      await tool(releaseWriteTools, 'delete_track')
        .handler({ track_id: ids.trackId }, ctx)
        .catch(() => undefined);
    }
    if (ids.releaseId !== undefined) {
      await tool(releaseWriteTools, 'delete_release')
        .handler({ release_id: ids.releaseId }, ctx)
        .catch(() => undefined);
    }
  });

  it('creates a draft, edits it, adds a track, and validates it', async () => {
    const ctx = context();

    // Discover a label, genre and artist from the account.
    const labels = collection(
      await tool(catalogReadTools, 'list_labels').handler({ per_page: 5 }, ctx),
    );
    const genres = collection(
      await tool(referenceTools, 'list_reference_data').handler({ type: 'genres' }, ctx),
    );
    const artists = collection(
      await tool(catalogReadTools, 'list_artists').handler({ per_page: 5 }, ctx),
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(genres.length).toBeGreaterThan(0);
    expect(artists.length).toBeGreaterThan(0);
    const labelId = labels[0].id as number;
    const genreId = genres[0].id as number;
    const artistId = artists[0].id as number;
    const releaseDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Create a DRAFT release (idempotency handled by the tool).
    const created = await tool(releaseWriteTools, 'create_release').handler(
      {
        fields: {
          content_type: 'Single',
          label_id: labelId,
          cat: `MCP-${Date.now()}`,
          artwork_ai_usage: 'none',
          primary_genre_id: genreId,
          release_date: releaseDate,
          artists: [{ artist_id: artistId, artistic_role: 'MainArtist' }],
          titles: [{ iso_code: 'en', text: 'MCP Contract Test Release' }],
        },
      },
      ctx,
    );
    ids.releaseId = resourceId(created);
    expect(ids.releaseId, `create_release failed: ${JSON.stringify(created)}`).toBeDefined();

    // Edit it.
    const updated = await tool(releaseWriteTools, 'update_release').handler(
      { release_id: ids.releaseId, fields: { cat: `MCP-${Date.now()}-v2` } },
      ctx,
    );
    expect('error' in updated).toBe(false);

    // Add a track with the required recording_country.
    const track = await tool(releaseWriteTools, 'create_track').handler(
      {
        fields: {
          release_id: ids.releaseId,
          disc: 1,
          track_num: 1,
          composition_type: 'original',
          audio_ai_usage: 'none',
          composition_ai_usage: 'none',
          commercial_samples: 'no',
          audio_language: 'en',
          recording_country: 'US',
          artists: [{ artist_id: artistId, artistic_role: 'MainArtist' }],
          titles: [{ iso_code: 'en', text: 'MCP Contract Test Track' }],
          contributors: [{ roles: { Producer: true }, ai_contribution: 'none' }],
        },
      },
      ctx,
    );
    ids.trackId = resourceId(track);

    // Validate: a draft with no audio/artwork must NOT pass cleanly.
    const validated = await tool(releaseWriteTools, 'validate_release').handler(
      { release_id: ids.releaseId },
      ctx,
    );
    const problems = validationProblems(validated);
    expect(problems, `validate_release returned no problems: ${JSON.stringify(validated)}`).toBe(
      true,
    );
  });
});

/** True when a validate_release result reports at least one blocking problem. */
function validationProblems(r: ApiResult<unknown>): boolean {
  if ('error' in r) return true; // 422 etc. counts as "did not pass clean".
  const d = r.data as { errors?: unknown; errors_structured?: unknown } | null;
  const list = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? 1 : 0);
  return list(d?.errors) > 0 || list(d?.errors_structured) > 0;
}
