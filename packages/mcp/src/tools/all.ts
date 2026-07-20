/** The complete tool catalog, in registration order. */

import { accountTools } from './account.js';
import { catalogTools } from './catalog.js';
import { distributionTools } from './distribution.js';
import { financeTools } from './finance.js';
import { insightsTools } from './insights.js';
import { referenceTools } from './reference.js';
import { releaseTools } from './releases.js';
import type { ToolDef } from './types.js';
import { webhookTools } from './webhooks.js';

export function allTools(): ToolDef[] {
  return [
    ...accountTools,
    ...referenceTools,
    ...catalogTools,
    ...releaseTools,
    ...insightsTools,
    ...financeTools,
    ...webhookTools,
    ...distributionTools,
  ];
}
