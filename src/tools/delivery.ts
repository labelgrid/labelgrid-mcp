/**
 * Delivery reads: the distribution queue and a release's smart-link landing
 * page configuration. Both read-only, in the `delivery` toolset.
 */

import { z } from 'zod';
import type { ToolDef } from './types.js';

const getDeliveryQueue: ToolDef = {
  name: 'get_delivery_queue',
  toolset: 'delivery',
  gate: 'read',
  title: 'Get the distribution queue',
  description:
    'List the distribution queue entries for your account, paginated — one entry per (release, outlet) delivery with its current status (e.g. pending review, processing, scheduled, complete, error). Filter by `release_id`, `outlet_id`, or `status`. Use this to see where a release is in the delivery pipeline to each store.',
  inputShape: {
    release_id: z.number().int().positive().optional().describe('Filter to one release.'),
    outlet_id: z.number().int().positive().optional().describe('Filter to one outlet/store.'),
    status: z.string().optional().describe('Filter by delivery status.'),
    page: z.number().int().positive().optional(),
    per_page: z.number().int().positive().optional(),
  },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) =>
    client.get('/queues/distro', {
      page: args.page,
      per_page: args.per_page,
      filter: {
        release_id: args.release_id,
        outlet_id: args.outlet_id,
        status: args.status,
      },
    }),
};

const getLandingConfig: ToolDef = {
  name: 'get_landing_config',
  toolset: 'delivery',
  gate: 'read',
  title: 'Get a release landing-page config',
  description:
    'Retrieve the smart-link landing-page configuration for a release: whether the links page is enabled, its style/mode, custom copy, the action list and any pre-order links. Pair with update_landing_config to change it.',
  inputShape: { release_id: z.number().int().positive() },
  annotations: { readOnlyHint: true },
  handler: (args, { client }) => client.get(`/releases/${args.release_id}/landing-config`),
};

export const deliveryTools: ToolDef[] = [getDeliveryQueue, getLandingConfig];
