import { hasAnalyticsKey } from './config.js';
import { buildRuntimeProperties } from './events.js';
import {
  getOrCreateDistinctId,
  hasAnalyticsMilestone,
  isAnalyticsEnabled,
  markAnalyticsMilestone,
} from './identity.js';
import { getAnalytics } from './provider.js';

export type AnalyticsMilestone =
  | 'mcp_first_tool_success'
  | 'mcp_photoshop_first_connected';

/**
 * Fires a one-time funnel milestone per install. Uses a persisted flag plus a
 * deterministic uuid so PostHog deduplicates accidental double-sends.
 */
export function captureAnalyticsMilestoneOnce(
  milestone: AnalyticsMilestone,
  properties: Record<string, unknown> = {}
): boolean {
  if (!isAnalyticsEnabled() || !hasAnalyticsKey()) return false;
  if (hasAnalyticsMilestone(milestone)) return false;

  markAnalyticsMilestone(milestone);
  const distinctId = getOrCreateDistinctId();
  getAnalytics().capture({
    name: milestone,
    properties: buildRuntimeProperties(properties),
    insertId: `${distinctId}:${milestone}`,
  });
  return true;
}
