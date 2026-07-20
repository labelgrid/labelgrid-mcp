// README.md "Legal notices" mirrors these strings — keep them in sync when editing.

/**
 * The legal / acceptable-use disclosure strings, surfaced at runtime in two
 * places: the MCP `instructions` field (shown by clients on initialize) and
 * stderr at startup. README.md "Legal notices" carries the same text for
 * readers who never launch the server.
 */

/** The one-paragraph AS-IS summary shown to every session. */
export const LEGAL_SUMMARY =
  'This software is provided AS-IS, without warranty of any kind, express or implied. By using it you accept sole responsibility for your use of the LabelGrid API and for every action taken by any AI client or agent you connect to this server, including write operations against your LabelGrid account. Your use of the API through this server is governed by the LabelGrid API Terms of Service and Acceptable Use Policy. This server does not bypass server-side protections such as rate limits, plan entitlements, or terms enforcement.';

/** Shown only when full writes are armed. */
export const FULL_WRITES_NOTICE =
  'Full writes are enabled. Distribution submissions, takedowns, and immutable file uploads initiated by an AI agent have real, potentially irreversible consequences for your releases on streaming platforms and stores. By setting the LABELGRID_FULL_WRITES_ACK acknowledgment variable you accepted that all such actions are your sole responsibility.';

/** The data-handling disclosure. */
export const DATA_HANDLING_NOTE =
  'This server transmits your LabelGrid catalogue and account data to the AI client you configure. Choosing that client, and disclosing that data flow where required, is your responsibility.';
