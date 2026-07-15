/**
 * Webhooks toolset: read your webhook subscriptions and delivery logs, and
 * manage them (create/update/delete/test/rotate-secret). Reads are always on;
 * the mutations are safe writes.
 */

import { z } from 'zod';
import type { ToolDef } from './types.js';

const webhookId = z.number().int().positive().describe('The webhook id.');
const eventsShape = z
  .record(z.string(), z.unknown())
  .describe(
    'The event subscription object selecting which event types this webhook receives. Call list_webhook_event_types for the available types and each payload shape.',
  );

const listWebhooks: ToolDef = {
  name: 'list_webhooks',
  toolset: 'webhooks',
  gate: 'read',
  title: 'List webhooks',
  description:
    'List the webhook subscriptions configured on your account, each with its URL, subscribed events and active state.',
  inputShape: {},
  annotations: { readOnlyHint: true },
  handler: (_args, { client }) => client.get('/webhooks'),
};

const getWebhook: ToolDef = {
  name: 'get_webhook',
  toolset: 'webhooks',
  gate: 'read',
  title: 'Get a webhook',
  description: 'Retrieve one webhook subscription by id.',
  inputShape: { webhook_id: webhookId },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(`/webhooks/${args.webhook_id}`),
};

const getWebhookLogs: ToolDef = {
  name: 'get_webhook_logs',
  toolset: 'webhooks',
  gate: 'read',
  title: 'Get webhook delivery logs',
  description:
    'Retrieve the recent delivery log for a webhook — the attempts, response codes and outcomes — to debug why events did or did not reach your endpoint.',
  inputShape: { webhook_id: webhookId },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(`/webhooks/${args.webhook_id}/logs`),
};

const listWebhookEventTypes: ToolDef = {
  name: 'list_webhook_event_types',
  toolset: 'webhooks',
  gate: 'read',
  title: 'List webhook event types',
  description:
    'List every available webhook event type, each with the schema of the payload it delivers. Use it to decide which events to subscribe a webhook to.',
  inputShape: {},
  annotations: { readOnlyHint: true },
  handler: (_args, { client }) => client.get('/webhooks/event-types'),
};

const createWebhook: ToolDef = {
  name: 'create_webhook',
  toolset: 'webhooks',
  gate: 'safe_write',
  title: 'Create a webhook',
  description:
    'Create a webhook subscription. `name` and `url` (the HTTPS endpoint that will receive events) are required, along with `events` selecting which event types to deliver. The API returns a signing secret once on creation — store it to verify incoming payloads.',
  inputShape: {
    name: z.string().describe('A label for this webhook.'),
    url: z.string().describe('The HTTPS endpoint that will receive event deliveries.'),
    events: eventsShape,
  },
  annotations: {},
  handler: (args, { client }) =>
    client.post('/webhooks', { name: args.name, url: args.url, events: args.events }),
};

const updateWebhook: ToolDef = {
  name: 'update_webhook',
  toolset: 'webhooks',
  gate: 'safe_write',
  title: 'Update a webhook',
  description:
    'Update a webhook subscription. Supply only the fields you want to change: `name`, `url`, `events`, or `is_active` (set false to pause deliveries).',
  inputShape: {
    webhook_id: webhookId,
    name: z.string().optional(),
    url: z.string().optional(),
    events: eventsShape.optional(),
    is_active: z.boolean().optional().describe('Set false to pause deliveries.'),
  },
  annotations: {},
  handler: (args, { client }) => {
    const { webhook_id, ...body } = args;
    return client.patch(`/webhooks/${webhook_id}`, body);
  },
};

const deleteWebhook: ToolDef = {
  name: 'delete_webhook',
  toolset: 'webhooks',
  gate: 'safe_write',
  title: 'Delete a webhook',
  description: 'Delete a webhook subscription permanently. It will stop receiving events.',
  inputShape: { webhook_id: webhookId },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => client.delete(`/webhooks/${args.webhook_id}`),
};

const testWebhook: ToolDef = {
  name: 'test_webhook',
  toolset: 'webhooks',
  gate: 'safe_write',
  title: 'Send a test webhook event',
  description:
    'Send a test event to a webhook’s endpoint so you can confirm it is reachable and your signature verification works. Safe to repeat.',
  inputShape: { webhook_id: webhookId },
  annotations: { idempotentHint: true },
  handler: (args, { client }) => client.post(`/webhooks/${args.webhook_id}/test`),
};

const rotateWebhookSecret: ToolDef = {
  name: 'rotate_webhook_secret',
  toolset: 'webhooks',
  gate: 'safe_write',
  title: 'Rotate a webhook signing secret',
  description:
    'Generate a new signing secret for a webhook and return it. WARNING: the old secret stops working immediately — update your endpoint’s signature verification with the new secret right away or deliveries will fail verification.',
  inputShape: { webhook_id: webhookId },
  annotations: { destructiveHint: true },
  handler: (args, { client }) => client.post(`/webhooks/${args.webhook_id}/regenerate-secret`),
};

export const webhookTools: ToolDef[] = [
  listWebhooks,
  getWebhook,
  getWebhookLogs,
  listWebhookEventTypes,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  rotateWebhookSecret,
];
