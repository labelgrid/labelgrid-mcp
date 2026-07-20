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
  // account
  'GET /me': 'get_account',
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
  // insights
  'GET /analytics/summary': 'get_analytics',
  // catalog reads
  'GET /labels': 'search_catalog',
  'GET /labels/{label}': 'get_catalog_item',
  'GET /artists': 'search_catalog',
  'GET /artists/{artist}': 'get_catalog_item',
  'GET /writers': 'search_catalog',
  'GET /writers/{writer}': 'get_catalog_item',
  'GET /publishers': 'search_catalog',
  'GET /publishers/{publisher}': 'get_catalog_item',
  'GET /releases': 'search_catalog',
  'GET /releases/{release}': 'get_catalog_item',
  'GET /tracks': 'search_catalog',
  'GET /tracks/{track}': 'get_catalog_item',
  // asset reads
  'GET /tracks/{track}/files/{fileType}': 'get_asset',
  'GET /tracks/{track}/licenses': 'list_track_licenses',
  'GET /tracks/{track}/licenses/{trackLicense}': 'list_track_licenses',
  'GET /releases/{release}/files/{assetType}': 'get_asset',
  // release review reads
  'GET /review-issues': 'get_release_review',
  'GET /issue-definitions': 'list_reference_data',
  'GET /releases/{release}/quality-report': 'get_release_review',
  'GET /stream-radar/flags': 'query_artificial_streaming',
  'GET /stream-radar/flags/{streamRadarFlag}': 'query_artificial_streaming',
  // delivery
  'GET /queues/distro': 'get_delivery_queue',
  'GET /releases/{release}/landing-config': 'get_landing_config',
  // finance
  'GET /statements': 'query_financials',
  'GET /statements/{invoiceNumber}': 'query_financials',
  'GET /statements/{invoiceNumber}/csv': 'download_statement',
  'GET /statements/export/csv': 'download_statement',
  'GET /statements/{invoiceNumber}/invoice': 'download_statement',
  'GET /transactions': 'query_financials',
  'GET /royalties/breakdown': 'query_financials',
  'GET /royalties/artificial-streams': 'query_artificial_streaming',
  'GET /artificial-streaming-fee/{period}': 'query_artificial_streaming',
  // webhooks
  'GET /webhooks': 'list_webhooks',
  'POST /webhooks': 'manage_webhook',
  'GET /webhooks/event-types': 'list_reference_data',
  'GET /webhooks/{webhook}': 'list_webhooks',
  'PATCH /webhooks/{webhook}': 'manage_webhook',
  'DELETE /webhooks/{webhook}': 'manage_webhook',
  'GET /webhooks/{webhook}/logs': 'list_webhooks',
  'POST /webhooks/{webhook}/regenerate-secret': 'manage_webhook',
  'POST /webhooks/{webhook}/test': 'manage_webhook',
  // catalog writes
  'POST /labels': 'create_catalog_item',
  'PATCH /labels/{label}': 'update_catalog_item',
  'DELETE /labels/{label}': 'delete_catalog_item',
  'POST /labels/{label}/images/{imageType}': 'upload_image',
  'POST /artists': 'create_catalog_item',
  'PATCH /artists/{artist}': 'update_catalog_item',
  'DELETE /artists/{artist}': 'delete_catalog_item',
  'POST /artists/{artist}/photo': 'upload_image',
  'POST /writers': 'create_catalog_item',
  'PATCH /writers/{writer}': 'update_catalog_item',
  'DELETE /writers/{writer}': 'delete_catalog_item',
  'POST /publishers': 'create_catalog_item',
  'PATCH /publishers/{publisher}': 'update_catalog_item',
  'DELETE /publishers/{publisher}': 'delete_catalog_item',
  // release/track draft writes
  'POST /releases': 'create_catalog_item',
  'PATCH /releases/{release}': 'update_catalog_item',
  'DELETE /releases/{release}': 'delete_catalog_item',
  'POST /tracks': 'create_catalog_item',
  'PATCH /tracks/{track}': 'update_catalog_item',
  'DELETE /tracks/{track}': 'delete_catalog_item',
  'POST /releases/{release}/validate': 'run_release_checks',
  'POST /releases/{release}/quality-report/refresh': 'run_release_checks',
  'PUT /releases/{release}/landing-config': 'manage_release_links',
  'POST /releases/short-url': 'manage_release_links',
  'POST /review-issues/{reviewReleaseIssue}/notes': 'add_review_issue_note',
  // full writes (distribution)
  'POST /tracks/{track}/files/{fileType}/upload-url': 'upload_asset',
  'PUT /tracks/{track}/files/{fileType}': 'upload_asset',
  'DELETE /tracks/{track}/files/{fileType}': 'delete_asset',
  'POST /releases/{release}/files/{assetType}/upload-url': 'upload_asset',
  'PUT /releases/{release}/files/{assetType}': 'upload_asset',
  'DELETE /releases/{release}/files/{assetType}': 'delete_asset',
  'POST /tracks/{track}/licenses': 'manage_track_license',
  'POST /tracks/{track}/licenses/{trackLicense}': 'manage_track_license',
  'DELETE /tracks/{track}/licenses/{trackLicense}': 'manage_track_license',
  'POST /releases/{release}/photo': 'upload_asset',
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
  'GET /account': 'get_account',
  'GET /tracks/{track}/files/{assetType}/download-url': 'get_asset',
};
