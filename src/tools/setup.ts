/**
 * Setup toolset: the single tool exposed when no API token is configured.
 *
 * In setup mode the server registers ONLY this tool. It makes no API calls —
 * it returns a structured, human-relayable guide that the AI client walks the
 * user through to create a LabelGrid API token and add it to their client
 * configuration. The `setup` toolset is deliberately NOT part of the tool
 * catalog and is not user-selectable via LABELGRID_TOOLSETS.
 */

import type { ToolDef } from './types.js';

// Mirrors the README Claude Desktop / Cursor snippet exactly (placeholder token).
const CLIENT_CONFIG_JSON = `{
  "mcpServers": {
    "labelgrid": {
      "command": "npx",
      "args": ["-y", "@labelgrid/mcp"],
      "env": {
        "LABELGRID_API_TOKEN": "your-token-here"
      }
    }
  }
}`;

/** The structured guide returned to the client, relayed to the user in chat. */
const SETUP_GUIDE = {
  status: 'not_connected',
  summary:
    'This LabelGrid MCP server is running in setup mode because no API token is configured yet. Walk the user through the steps below so their AI client can connect to their LabelGrid account. Relay the steps in plain language and never ask the user to paste their token into the chat.',
  steps: [
    'Make sure the account has API access: it is part of LabelGrid API plans — see the API Overview and Quickstart (https://help.labelgrid.com/en/integrations/api-overview). If the API Tokens page is missing from the dashboard, the account does not have API access yet.',
    'Log in to your LabelGrid dashboard and open Profile → API Tokens (https://app.labelgrid.com/user/profile/api-tokens).',
    'Create a new token and copy it.',
    'Add the token to your MCP client configuration as the LABELGRID_API_TOKEN environment variable (do NOT paste the token into this chat).',
    'Restart your MCP client (or the server) — the full toolset loads automatically once the token is configured.',
  ],
  config_examples: {
    claude_desktop: CLIENT_CONFIG_JSON,
    claude_code:
      'claude mcp add labelgrid -e LABELGRID_API_TOKEN=your-token-here -- npx -y @labelgrid/mcp',
    cursor: CLIENT_CONFIG_JSON,
  },
  security_note:
    'Never paste your API token into the chat — it belongs only in your client configuration file. Anyone with the token can access your account until you revoke it in the dashboard.',
  optional_settings: [
    'LABELGRID_ENABLE_WRITES — safe draft-stage writes; on by default, set false for read-only (see the README Safety section).',
    'LABELGRID_ENABLE_FULL_WRITES (plus LABELGRID_FULL_WRITES_ACK) — arm consequential distribution actions; off by default (see the README Safety section).',
    'LABELGRID_TOOLSETS — expose only a comma-separated subset of toolsets: account, reference, catalog, releases, insights, finance, webhooks, distribution (pre-0.3.0 names are still accepted as aliases). The webhooks toolset is off by default — name it explicitly here to enable it (see the README Configuration section).',
    'LABELGRID_READ_ONLY — force reads only, overriding the write flags (see the README Safety section).',
  ],
} as const;

const setup: ToolDef = {
  name: 'setup',
  toolset: 'setup',
  gate: 'read',
  title: 'Set up the LabelGrid connection',
  description:
    'This LabelGrid MCP server is not connected to an account yet because no API token is configured. Call this tool to get step-by-step instructions to walk the user through creating a LabelGrid API token and adding it to their MCP client configuration. Returns the setup steps, ready-to-copy client config examples (with a placeholder token), a security note, and the optional settings. Makes no API calls.',
  inputShape: {},
  annotations: { readOnlyHint: true },
  handler: () => Promise.resolve({ data: SETUP_GUIDE }),
};

export const setupTools: ToolDef[] = [setup];
