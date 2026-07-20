import { describe, expect, it } from 'vitest';
import { ENTITIES, ENTITY_NAMES } from '../../src/entities.js';

describe('entity registry', () => {
  it('declares exactly the six catalog entities', () => {
    expect([...ENTITY_NAMES]).toEqual([
      'label',
      'artist',
      'writer',
      'publisher',
      'release',
      'track',
    ]);
    expect(Object.keys(ENTITIES).sort()).toEqual([...ENTITY_NAMES].sort());
  });

  it('maps each entity to its collection endpoint path', () => {
    expect(ENTITIES.label.path).toBe('/labels');
    expect(ENTITIES.artist.path).toBe('/artists');
    expect(ENTITIES.writer.path).toBe('/writers');
    expect(ENTITIES.publisher.path).toBe('/publishers');
    expect(ENTITIES.release.path).toBe('/releases');
    expect(ENTITIES.track.path).toBe('/tracks');
  });

  it('carries non-empty docs for every entity', () => {
    for (const name of ENTITY_NAMES) {
      const spec = ENTITIES[name];
      expect(spec.filtersDoc.length).toBeGreaterThan(0);
      expect(spec.fieldsDoc.length).toBeGreaterThan(0);
      expect(spec.deleteNote.length).toBeGreaterThan(0);
    }
  });

  it('keeps the reviewed caveats from the per-entity tool descriptions', () => {
    // Track create requires recording_country (ISO 3166-1 alpha-2).
    expect(ENTITIES.track.fieldsDoc).toContain('recording_country');
    expect(ENTITIES.track.fieldsDoc).toContain('ISO 3166-1 alpha-2');
    // Release update surfaces RELEASE_LOCKED_FIELDS verbatim on locked fields.
    expect(ENTITIES.release.fieldsDoc).toContain('RELEASE_LOCKED_FIELDS');
    // The documented list filters survive.
    expect(ENTITIES.release.filtersDoc).toContain('label_id');
    expect(ENTITIES.release.filtersDoc).toContain('is_live');
    expect(ENTITIES.release.filtersDoc).toContain('barcode_number');
    expect(ENTITIES.release.filtersDoc).toContain('cat');
    expect(ENTITIES.track.filtersDoc).toContain('release_id');
    expect(ENTITIES.track.filtersDoc).toContain('isrc');
    expect(ENTITIES.artist.filtersDoc).toContain('artist_name');
    expect(ENTITIES.writer.filtersDoc).toContain('ipi');
    expect(ENTITIES.publisher.filtersDoc).toContain('ipi');
    // The delete refusals survive.
    expect(ENTITIES.label.deleteNote).toContain('releases');
    expect(ENTITIES.artist.deleteNote).toContain('referenced');
    expect(ENTITIES.writer.deleteNote).toContain('tracks');
    expect(ENTITIES.publisher.deleteNote).toContain('writers');
    expect(ENTITIES.release.deleteNote).toContain('draft');
    expect(ENTITIES.track.deleteNote).toContain('draft');
  });
});
