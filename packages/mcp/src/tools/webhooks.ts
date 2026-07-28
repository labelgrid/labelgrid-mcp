/**
 * Webhooks toolset: read your webhook subscriptions and delivery logs
 * (list_webhooks) and manage them (manage_webhook: create/update/delete/test/
 * rotate_secret). The read is always on; the mutations are safe writes.
 */

import { z } from 'zod';
import type { ToolDef } from './types.js';

const webhookId = z.number().int().positive().optional().describe('The webhook id.');

const listWebhooks: ToolDef = {
  name: 'list_webhooks',
  toolset: 'webhooks',
  gate: 'read',
  title: 'List webhooks',
  description:
    "Read your webhook subscriptions. `view: 'config'` (the default) lists them — URL, subscribed events, active state — or retrieves one when `webhook_id` is given. " +
    "`view: 'logs'` retrieves the recent delivery log for a webhook (`webhook_id` required) — attempts, response codes and outcomes — to debug why events did or did not reach your endpoint.",
  inputShape: {
    webhook_id: webhookId,
    view: z.enum(['config', 'logs']).optional().describe('config (default) or logs.'),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => {
    const view = (args.view as string | undefined) ?? 'config';
    if (view === 'logs') {
      if (args.webhook_id === undefined) {
        return Promise.resolve({
          error: {
            code: 'INVALID_SELECTOR',
            message: "view 'logs' requires `webhook_id` — the webhook whose delivery log to read.",
            status: 0,
          },
        });
      }
      return client.get(`/webhooks/${args.webhook_id}/logs`);
    }
    if (args.webhook_id !== undefined) {
      return client.get(`/webhooks/${args.webhook_id}`);
    }
    return client.get('/webhooks');
  },
};

const manageWebhook: ToolDef = {
  name: 'manage_webhook',
  toolset: 'webhooks',
  gate: 'safe_write',
  title: 'Manage a webhook',
  description:
    'Manage a webhook subscription. Pick ONE action with `action`: ' +
    '`create` — `fields`: `name`, `url` (the HTTPS endpoint receiving deliveries), `events` (see list_reference_data type webhook_event_types); the signing secret is returned ONCE on creation — store it to verify payloads. ' +
    '`update` — supply only the fields to change in `fields`: name, url, events, or is_active (false pauses deliveries). ' +
    '`delete` — permanently removes the subscription. ' +
    '`test` — sends a test event to confirm reachability and signature verification. ' +
    '`rotate_secret` — returns a new signing secret — WARNING: the old secret stops working immediately; update your endpoint or deliveries fail verification. ' +
    '`webhook_id` is required for every action except create.',
  inputShape: {
    action: z
      .enum(['create', 'update', 'delete', 'test', 'rotate_secret'])
      .describe('Which action.'),
    webhook_id: webhookId,
    fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('The webhook attributes, forwarded verbatim.'),
  },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => {
    const action = args.action as string;
    if (action === 'create') {
      return client.post('/webhooks', args.fields);
    }
    if (args.webhook_id === undefined) {
      return Promise.resolve({
        error: {
          code: 'INVALID_SELECTOR',
          message: `action '${action}' requires \`webhook_id\` — the webhook to act on. Only action 'create' works without one.`,
          status: 0,
        },
      });
    }
    switch (action) {
      case 'update':
        return client.patch(`/webhooks/${args.webhook_id}`, args.fields);
      case 'delete':
        return client.delete(`/webhooks/${args.webhook_id}`);
      case 'test':
        return client.post(`/webhooks/${args.webhook_id}/test`);
      default: // rotate_secret
        return client.post(`/webhooks/${args.webhook_id}/regenerate-secret`);
    }
  },
};

export const webhookTools: ToolDef[] = [listWebhooks, manageWebhook];
