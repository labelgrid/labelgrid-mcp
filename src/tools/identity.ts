/** Identity toolset: read the authenticated account, revoke API tokens. */

import { z } from 'zod';
import type { ToolDef } from './types.js';

const getMe: ToolDef = {
  name: 'get_me',
  toolset: 'identity',
  gate: 'read',
  title: 'Get my account',
  description:
    'Return the authenticated LabelGrid account profile, including the release submission limit/quota and terms-acceptance status. Use this to confirm which account your API token belongs to before making other calls.',
  inputShape: {},
  annotations: { readOnlyHint: true },
  handler: (_args, { client }) => client.get('/me'),
};

const revokeApiToken: ToolDef = {
  name: 'revoke_api_token',
  toolset: 'identity',
  gate: 'safe_write',
  title: 'Revoke an API token',
  description:
    'Revoke a LabelGrid API token. Pass token_id to revoke a specific token; omit it to revoke the token currently in use. WARNING: revoking the current token immediately ends this session — the server loses access and stops working until you configure a new token.',
  inputShape: { token_id: z.number().int().positive().optional() },
  annotations: { destructiveHint: true, idempotentHint: true },
  handler: (args, { client }) => {
    const tokenId = args.token_id as number | undefined;
    return tokenId === undefined
      ? client.delete('/tokens/current')
      : client.delete(`/tokens/${tokenId}`);
  },
};

export const identityTools: ToolDef[] = [getMe, revokeApiToken];
