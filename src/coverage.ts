/**
 * The endpoint-coverage manifest, consumed by the API-coverage drift check.
 *
 * `COVERAGE` maps every public endpoint (method + path) this server exposes as a
 * tool to that tool's name. `EXCLUDED` lists public endpoints deliberately not
 * exposed in v1, each with a short customer-appropriate reason. `PENDING_DOCS`
 * lists tool endpoints whose reference documentation is still being generated
 * (the drift check tolerates their absence from the API document snapshot).
 *
 * The drift check fails when the live API document contains a path+method that
 * is neither covered nor excluded — the signal to add a tool (or an exclusion)
 * in the same cycle the API grows.
 *
 * Keys use the API document's exact path templates (e.g. `{release}`) and an
 * uppercase method followed by a single space.
 */

export const COVERAGE: Record<string, string> = {
  // identity
  'GET /me': 'get_me',
  'DELETE /tokens/current': 'revoke_api_token',
  'DELETE /tokens/{tokenId}': 'revoke_api_token',
  // reference
  'GET /genres': 'list_reference_data',
  'GET /genre-categories': 'list_reference_data',
  'GET /languages': 'list_reference_data',
  'GET /contributor-roles': 'list_reference_data',
  'GET /instruments': 'list_reference_data',
  'GET /distro-outlets': 'list_reference_data',
  'GET /territories': 'list_reference_data',
  // analytics
  'GET /analytics/summary': 'get_analytics',
  // catalog reads
  'GET /labels': 'list_labels',
  'GET /labels/{label}': 'get_label',
  'GET /artists': 'list_artists',
  'GET /artists/{artist}': 'get_artist',
  'GET /writers': 'list_writers',
  'GET /writers/{writer}': 'get_writer',
  'GET /publishers': 'list_publishers',
  'GET /publishers/{publisher}': 'get_publisher',
  'GET /releases': 'list_releases',
  'GET /releases/{release}': 'get_release',
  'GET /tracks': 'list_tracks',
  'GET /tracks/{track}': 'get_track',
  // files reads
  'GET /tracks/{track}/files/{fileType}': 'get_track_file',
  'GET /tracks/{track}/licenses': 'list_track_licenses',
  'GET /tracks/{track}/licenses/{trackLicense}': 'get_track_license',
  'GET /releases/{release}/files/{assetType}': 'get_release_file',
  // review reads
  'GET /review-issues': 'list_review_issues',
  'GET /issue-definitions': 'list_issue_definitions',
  'GET /releases/{release}/quality-report': 'get_quality_report',
  'GET /stream-radar/flags': 'list_stream_radar_flags',
  'GET /stream-radar/flags/{streamRadarFlag}': 'get_stream_radar_flag',
  // delivery
  'GET /queues/distro': 'get_delivery_queue',
  'GET /releases/{release}/landing-config': 'get_landing_config',
  // accounting
  'GET /statements': 'list_statements',
  'GET /statements/{invoiceNumber}': 'get_statement',
  'GET /statements/{invoiceNumber}/csv': 'download_statement_csv',
  'GET /statements/export/csv': 'download_statement_csv',
  'GET /statements/{invoiceNumber}/invoice': 'download_statement_invoice',
  'GET /transactions': 'list_transactions',
  'GET /royalties/breakdown': 'get_royalties_breakdown',
  'GET /royalties/artificial-streams': 'list_artificial_streams',
  'GET /artificial-streaming-fee/{period}': 'get_artificial_fee_breakdown',
  // webhooks
  'GET /webhooks': 'list_webhooks',
  'POST /webhooks': 'create_webhook',
  'GET /webhooks/event-types': 'list_webhook_event_types',
  'GET /webhooks/{webhook}': 'get_webhook',
  'PATCH /webhooks/{webhook}': 'update_webhook',
  'DELETE /webhooks/{webhook}': 'delete_webhook',
  'GET /webhooks/{webhook}/logs': 'get_webhook_logs',
  'POST /webhooks/{webhook}/regenerate-secret': 'rotate_webhook_secret',
  'POST /webhooks/{webhook}/test': 'test_webhook',
  // catalog writes
  'POST /labels': 'create_label',
  'PATCH /labels/{label}': 'update_label',
  'DELETE /labels/{label}': 'delete_label',
  'POST /labels/{label}/images/{imageType}': 'upload_label_image',
  'POST /artists': 'create_artist',
  'PATCH /artists/{artist}': 'update_artist',
  'DELETE /artists/{artist}': 'delete_artist',
  'POST /artists/{artist}/photo': 'upload_artist_photo',
  'POST /writers': 'create_writer',
  'PATCH /writers/{writer}': 'update_writer',
  'DELETE /writers/{writer}': 'delete_writer',
  'POST /publishers': 'create_publisher',
  'PATCH /publishers/{publisher}': 'update_publisher',
  'DELETE /publishers/{publisher}': 'delete_publisher',
  // release/track draft writes
  'POST /releases': 'create_release',
  'PATCH /releases/{release}': 'update_release',
  'DELETE /releases/{release}': 'delete_release',
  'POST /tracks': 'create_track',
  'PATCH /tracks/{track}': 'update_track',
  'DELETE /tracks/{track}': 'delete_track',
  'POST /releases/{release}/validate': 'validate_release',
  'POST /releases/{release}/quality-report/refresh': 'refresh_quality_report',
  'PUT /releases/{release}/landing-config': 'update_landing_config',
  'POST /releases/short-url': 'create_release_short_url',
  'POST /review-issues/{reviewReleaseIssue}/notes': 'add_review_issue_note',
  // full writes (distribution)
  'POST /tracks/{track}/files/{fileType}/upload-url': 'upload_track_audio',
  'PUT /tracks/{track}/files/{fileType}': 'upload_track_audio',
  'DELETE /tracks/{track}/files/{fileType}': 'delete_track_audio',
  'POST /releases/{release}/files/{assetType}/upload-url': 'upload_release_asset',
  'PUT /releases/{release}/files/{assetType}': 'upload_release_asset',
  'DELETE /releases/{release}/files/{assetType}': 'delete_release_asset',
  'POST /tracks/{track}/licenses': 'upload_track_license',
  'POST /tracks/{track}/licenses/{trackLicense}': 'update_track_license',
  'DELETE /tracks/{track}/licenses/{trackLicense}': 'delete_track_license',
  'POST /releases/{release}/photo': 'upload_release_artwork',
  'POST /releases/{release}/distribute': 'distribute_release',
  'POST /releases/{release}/takedown-all': 'takedown_release',
  'POST /releases/{release}/confirm-review': 'confirm_review',
  'POST /labels/{label}/enable-beatport': 'enable_beatport',
};

export const EXCLUDED: Record<string, string> = {
  // The per-metric analytics endpoints are all served by get_analytics.
  'GET /analytics/streams': 'served by get_analytics (summary)',
  'GET /analytics/listeners': 'served by get_analytics (summary)',
  'GET /analytics/saves': 'served by get_analytics (summary)',
  'GET /analytics/skips': 'served by get_analytics (summary)',
  'GET /analytics/shares': 'served by get_analytics (summary)',
  'GET /analytics/completion-rate': 'served by get_analytics (summary)',
  'GET /analytics/lyrics-view-rate': 'served by get_analytics (summary)',
  'GET /analytics/canvas-view-rate': 'served by get_analytics (summary)',
  'GET /analytics/device-split': 'served by get_analytics (summary)',
  'GET /analytics/source-split': 'served by get_analytics (summary)',
  'GET /analytics/saves-by-tier': 'served by get_analytics (summary)',
  'GET /analytics/streams-by-country': 'served by get_analytics (summary)',
  'GET /analytics/streams-by-gender': 'served by get_analytics (summary)',
  'GET /analytics/streams-by-age': 'served by get_analytics (summary)',
  'GET /analytics/shares-by-country': 'served by get_analytics (summary)',
  // Alternate/adjacent surfaces intentionally not exposed in v1.
  'POST /releases/{release}/withdraw-review': 'withdraw-review flow — not exposed in v1',
  'GET /resolve/label/{labelSlug}': 'label-website resolution — not exposed in v1',
  'GET /site-settings/{label}': 'label-website settings — not exposed in v1',
  'GET /site-settings/links/{label}': 'label-website settings — not exposed in v1',
  'GET /tracks/{track}/licenses/{trackLicense}/download':
    'license file download — not exposed in v1',
  'GET /transactions/csv': 'transaction CSV export — not exposed in v1',
};

export const PENDING_DOCS: Record<string, string> = {
  'GET /account': 'get_account_summary',
  'GET /tracks/{track}/files/{assetType}/download-url': 'get_track_audio_download_url',
};
