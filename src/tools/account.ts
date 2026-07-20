/** Account toolset: read the authenticated account, revoke API tokens. */

import { z } from 'zod';
import type { ToolDef } from './types.js';

const getAccount: ToolDef = {
  name: 'get_account',
  toolset: 'account',
  gate: 'read',
  title: 'Get account',
  description:
    'Read the authenticated LabelGrid account. Pick ONE view with `view`: ' +
    '`profile` returns the account profile — including the release submission limit/quota and terms-acceptance status — use it to confirm which account your API token belongs to before making other calls; ' +
    '`balance` returns your accounting summary — current balance and related account-level financial totals.',
  inputShape: {
    view: z.enum(['profile', 'balance']).describe('Which account read.'),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(args.view === 'balance' ? '/account' : '/me'),
};

const revokeApiToken: ToolDef = {
  name: 'revoke_api_token',
  toolset: 'account',
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

export const accountTools: ToolDef[] = [getAccount, revokeApiToken];
