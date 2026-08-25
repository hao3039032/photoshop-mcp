export type AnalyticsEventSource = 'ui' | 'server' | 'mcp';

export type AnalyticsPropertyValue =
  | string
  | number
  | boolean
  | string[]
  | null
  | undefined;

export interface AnalyticsEvent {
  name: string;
  properties?: Record<string, AnalyticsPropertyValue>;
  /** PostHog uuid for deduplication. */
  insertId?: string;
}

export interface BetaTelemetryState {
  betaTelemetryOptIn: boolean;
  betaTelemetryPromptAnswered: boolean;
}

export interface AnalyticsRuntimeConfig {
  enabled: boolean;
  provider: 'posthog';
  key: string;
  apiHost: string;
  uiHost: string;
  distinctId: string;
  betaTelemetryOptIn: boolean;
  betaTelemetryPromptAnswered: boolean;
}

export type UsageSurface = 'mcp' | 'server' | 'ui';

export interface AnalyticsProvider {
  capture(event: AnalyticsEvent): void;
  identify(properties?: Record<string, unknown>): void;
  /** Set person properties only when not already set (install cohorts). */
  setPersonOnce(properties: Record<string, unknown>): void;
  /** Push queued events without shutting down the client. */
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
