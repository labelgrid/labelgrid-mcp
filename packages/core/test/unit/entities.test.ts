import { describe, expect, it } from 'vitest';
import { ENTITIES, ENTITY_NAMES, REPLACEMENT_ENTITIES } from '../../src/entities.js';

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
    // The RELEASE_LOCKED_FIELDS caveat belongs to the UPDATE path, so it lives on
    // update_catalog_item's own description — never duplicated into fieldsDoc,
    // which is assembled into the create description every client holds.
    expect(ENTITIES.release.fieldsDoc).not.toContain('RELEASE_LOCKED_FIELDS');
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
    // The delete refusals survive. (What the writer and publisher refusals name
    // is pinned in its own test below — this one only checks they survived.)
    expect(ENTITIES.label.deleteNote).toContain('releases');
    expect(ENTITIES.artist.deleteNote).toContain('referenced');
    expect(ENTITIES.writer.deleteNote).toContain('tracks');
    expect(ENTITIES.publisher.deleteNote).toContain('tracks');
    expect(ENTITIES.release.deleteNote).toContain('draft');
    expect(ENTITIES.track.deleteNote).toContain('draft');
  });

  it('declares delete-replacement support per entity: writer and publisher only', () => {
    // Stated for every entity rather than inferred, so a seventh entity cannot
    // inherit an answer nobody gave.
    for (const name of ENTITY_NAMES) {
      expect(typeof ENTITIES[name].acceptsDeleteReplacement).toBe('boolean');
    }
    expect(ENTITY_NAMES.filter((n) => ENTITIES[n].acceptsDeleteReplacement)).toEqual([
      'writer',
      'publisher',
    ]);
    expect([...REPLACEMENT_ENTITIES]).toEqual(['writer', 'publisher']);
  });

  it('names the real refusals on the writer and publisher delete notes', () => {
    // A writer delete is refused on TRACK and ARTIST credits — both, not tracks alone.
    expect(ENTITIES.writer.deleteNote).toContain('tracks');
    expect(ENTITIES.writer.deleteNote).toContain('artists');
    // A publisher delete is refused on TRACK credits and on a LABEL's default
    // publishers. It is not refused on writer references, so that is pinned as a
    // negative: the note said so once and it was never true.
    expect(ENTITIES.publisher.deleteNote).toContain('tracks');
    expect(ENTITIES.publisher.deleteNote).toContain('label');
    expect(ENTITIES.publisher.deleteNote).not.toContain('writers');
    // Both name the way past the refusal.
    expect(ENTITIES.writer.deleteNote).toContain('replace_with');
    expect(ENTITIES.publisher.deleteNote).toContain('replace_with');
    // No other entity's note offers a parameter its endpoint does not accept.
    for (const name of ENTITY_NAMES) {
      if (ENTITIES[name].acceptsDeleteReplacement) continue;
      expect(ENTITIES[name].deleteNote).not.toContain('replace_with');
    }
  });
});
