/**
 * The catalog-entity registry: the six entity kinds the consolidated catalog
 * tools operate on, each with its endpoint path and the reviewed documentation
 * fragments (list filters, create/update fields, delete refusals) the tool
 * descriptions are assembled from.
 *
 * This is data, not behavior — the catalog tools stay thin wrappers and the
 * API owns all validation. The wording here carries the caveats from the
 * per-entity tool descriptions it replaces (recording_country on track create,
 * RELEASE_LOCKED_FIELDS on release update, the delete refusals).
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
    filtersDoc: 'label: no documented filters — paginate with page/per_page.',
    fieldsDoc:
      'label — required: name (string), default_email (string); common optional: active, support_email, website_url, spotify_url, applemusic_url, default_copyright_name_p_line, default_copyright_name_c_line, isrc_base, enable_website, image.',
    deleteNote:
      'label: the API refuses to delete a label that still has releases — remove or reassign its releases first.',
  },
  artist: {
    path: '/artists',
    filtersDoc: 'artist: artist_name (filter by artist name).',
    fieldsDoc:
      'artist — required: artist_name (string); common optional: full_name, email, location, bio_short, bio_full, isni, default_language, and platform profile URLs (spotify_url, applemusic_url, youtube_url, etc.).',
    deleteNote:
      'artist: the API refuses deletion when the artist is still referenced by releases or tracks.',
  },
  writer: {
    path: '/writers',
    filtersDoc: 'writer: name (writer name), ipi (IPI number).',
    fieldsDoc:
      'writer — required: first_name (string), last_name (string); common optional: middle_name, display_credits, email, country, pro, ipi, isni, publisher_id (or publisher_name/publisher_pro/publisher_ipi).',
    deleteNote: 'writer: the API refuses deletion when the writer is still referenced by tracks.',
  },
  publisher: {
    path: '/publishers',
    filtersDoc: 'publisher: name (publisher name), ipi (IPI number).',
    fieldsDoc:
      'publisher — required: name (string); common optional: ipi, pro, isni, controlled_publisher.',
    deleteNote:
      'publisher: the API refuses deletion when the publisher is still referenced by writers.',
  },
  release: {
    path: '/releases',
    filtersDoc:
      'release: label_id (owning label id), is_live (1 = live/distributed only), barcode_number (UPC/EAN), cat (catalog number).',
    fieldsDoc:
      'release — required on create: content_type, label_id, artists, titles, cat (catalog number), artwork_ai_usage, primary_genre_id; many optional fields (dates, copyright lines, genres, per-outlet URLs). Once a release has been submitted or distributed some fields are locked: changing a locked field returns a 403 with code RELEASE_LOCKED_FIELDS, surfaced verbatim so you can see exactly which fields cannot be changed.',
    deleteNote:
      'release: only a draft that has never been submitted can be deleted; the API refuses to delete a release that has been submitted or distributed.',
  },
  track: {
    path: '/tracks',
    filtersDoc: 'track: release_id (one release’s tracks), isrc (filter by ISRC).',
    fieldsDoc:
      'track — required on create: release_id, disc, track_num, composition_type, artists, audio_ai_usage, composition_ai_usage, commercial_samples, audio_language, contributors, and recording_country (a required ISO 3166-1 alpha-2 country code, e.g. "US"); optional: titles, isrc, iswc, writers, publishers, splits, and more. Some fields lock once the parent release is submitted or distributed.',
    deleteNote:
      'track: allowed while the parent release is an editable draft; the API refuses once the release is submitted or distributed.',
  },
};
