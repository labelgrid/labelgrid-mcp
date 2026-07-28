/**
 * The catalog-entity registry: the six entity kinds the consolidated catalog
 * tools operate on, each with its endpoint path and the reviewed documentation
 * fragments (list filters, create/update fields, delete refusals) the tool
 * descriptions are assembled from.
 *
 * This is data, not behavior — the catalog tools stay thin wrappers and the
 * API owns all validation. The wording here carries the caveats from the
 * per-entity tool descriptions it replaces (recording_country on track create,
 * the delete refusals). Caveats that belong to ONE tool stay in that tool's own
 * description — the RELEASE_LOCKED_FIELDS rule lives on update_catalog_item, so
 * repeating it here would only pad every client's catalog.
 */

export type EntityName = 'label' | 'artist' | 'writer' | 'publisher' | 'release' | 'track';

/** The entity names as a tuple, for zod enum inputs. */
export const ENTITY_NAMES = ['label', 'artist', 'writer', 'publisher', 'release', 'track'] as const;

export type EntitySpec = {
  /** The collection endpoint path, e.g. '/labels'. */
  path: string;
  /** One-line doc of the useful list filters for search_catalog. */
  filtersDoc: string;
  /** One-line doc of required + common create/update fields. */
  fieldsDoc: string;
  /** One-line doc of the server-side delete refusals. */
  deleteNote: string;
};

export const ENTITIES: Record<EntityName, EntitySpec> = {
  label: {
    path: '/labels',
    filtersDoc: 'label: no documented filters.',
    fieldsDoc:
      'label — required: name, default_email; optional: support email, website/platform URLs, default copyright lines, isrc_base.',
    deleteNote:
      'label: refused while the label still has releases — remove or reassign its releases first.',
  },
  artist: {
    path: '/artists',
    filtersDoc: 'artist: artist_name.',
    fieldsDoc:
      'artist — required: artist_name; optional: full_name, email, location, bios, isni, default_language, platform profile URLs.',
    deleteNote: 'artist: refused while still referenced by releases or tracks.',
  },
  writer: {
    path: '/writers',
    filtersDoc: 'writer: name, ipi.',
    fieldsDoc:
      'writer — required: first_name, last_name; optional: middle_name, display_credits, email, country, pro, ipi, isni, publisher_id (or publisher_name/publisher_pro/publisher_ipi).',
    deleteNote: 'writer: refused while still referenced by tracks.',
  },
  publisher: {
    path: '/publishers',
    filtersDoc: 'publisher: name, ipi.',
    fieldsDoc: 'publisher — required: name; optional: ipi, pro, isni, controlled_publisher.',
    deleteNote: 'publisher: refused while still referenced by writers.',
  },
  release: {
    path: '/releases',
    filtersDoc: 'release: label_id, is_live (1 = live only), barcode_number (UPC/EAN), cat.',
    fieldsDoc:
      'release — required on create: content_type, label_id, artists, titles, cat (catalog number), artwork_ai_usage, primary_genre_id; many optional fields (dates, copyright lines, genres, per-outlet URLs).',
    deleteNote: 'release: only a never-submitted draft can be deleted.',
  },
  track: {
    path: '/tracks',
    filtersDoc: 'track: release_id, isrc.',
    fieldsDoc:
      'track — required on create: release_id, disc, track_num, composition_type, artists, audio_ai_usage, composition_ai_usage, commercial_samples, audio_language, contributors, and recording_country (ISO 3166-1 alpha-2, e.g. "US"); optional: titles, isrc, iswc, writers, publishers, splits, and more.',
    deleteNote: 'track: refused once the release is no longer an editable draft.',
  },
};
