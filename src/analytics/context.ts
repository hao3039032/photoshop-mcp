import { loadConfig } from '../ui/config.js';
import { isAnalyticsEnabled, isBetaTelemetryOptIn } from './identity.js';

function isActionPlanEnabled(): boolean {
  try {
    return Boolean(loadConfig().actionPlanBeta);
  } catch {
    // The MCP SEA executable intentionally does not ship better-sqlite3's
    // native binding. UI-only configuration must not prevent stdio/HTTP
    // startup; the action-plan feature is not used by those entry points.
    return false;
  }
}

export function getServerAnalyticsContext(): Record<string, boolean> {
  const analyticsEnabled = isAnalyticsEnabled();
  return {
    privacy_mode: !analyticsEnabled,
    analytics_enabled: analyticsEnabled,
    beta_telemetry_opt_in: isBetaTelemetryOptIn(),
    action_plan_enabled: isActionPlanEnabled(),
  };
}
