/** The complete tool catalog, in registration order. */

import { accountingTools } from './accounting.js';
import { analyticsTools } from './analytics.js';
import { catalogReadTools } from './catalog-read.js';
import { catalogWriteTools } from './catalog-write.js';
import { deliveryTools } from './delivery.js';
import { filesReadTools } from './files-read.js';
import { fullWriteTools } from './full-writes.js';
import { identityTools } from './identity.js';
import { referenceTools } from './reference.js';
import { releaseWriteTools } from './release-write.js';
import { reviewReadTools } from './review-read.js';
import type { ToolDef } from './types.js';
import { webhookTools } from './webhooks.js';

export function allTools(): ToolDef[] {
  return [
    ...identityTools,
    ...referenceTools,
    ...analyticsTools,
    ...catalogReadTools,
    ...filesReadTools,
    ...reviewReadTools,
    ...deliveryTools,
    ...accountingTools,
    ...webhookTools,
    ...catalogWriteTools,
    ...releaseWriteTools,
    ...fullWriteTools,
  ];
}
