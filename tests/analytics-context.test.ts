import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  isAnalyticsEnabled: vi.fn(),
  isBetaTelemetryOptIn: vi.fn(),
}));

vi.mock('../src/ui/config.js', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../src/analytics/identity.js', () => ({
  isAnalyticsEnabled: mocks.isAnalyticsEnabled,
  isBetaTelemetryOptIn: mocks.isBetaTelemetryOptIn,
}));

import { getServerAnalyticsContext } from '../src/analytics/context.js';

describe('getServerAnalyticsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAnalyticsEnabled.mockReturnValue(true);
    mocks.isBetaTelemetryOptIn.mockReturnValue(false);
  });

  it('reports the configured action-plan state when UI storage is available', () => {
    mocks.loadConfig.mockReturnValue({ actionPlanBeta: true });

    expect(getServerAnalyticsContext()).toEqual({
      privacy_mode: false,
      analytics_enabled: true,
      beta_telemetry_opt_in: false,
      action_plan_enabled: true,
    });
  });

  it('falls back safely when UI storage is unavailable in a SEA executable', () => {
    mocks.loadConfig.mockImplementation(() => {
      throw new Error('better-sqlite3 native binding is unavailable');
    });

    expect(getServerAnalyticsContext()).toEqual({
      privacy_mode: false,
      analytics_enabled: true,
      beta_telemetry_opt_in: false,
      action_plan_enabled: false,
    });
  });
});
