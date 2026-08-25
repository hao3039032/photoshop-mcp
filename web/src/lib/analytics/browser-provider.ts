/**
 * Browser analytics — PostHog only.
 */
import * as posthogBrowser from './posthog-browser';

export interface BrowserAnalyticsConfig {
  enabled: boolean;
  provider: 'posthog';
  key: string;
  apiHost: string;
  uiHost: string;
  distinctId: string;
}

export function initBrowserAnalytics(config: BrowserAnalyticsConfig): void {
  posthogBrowser.initPostHogBrowser(config);
}

export function registerBrowserAnalyticsContext(
  properties: Record<string, string | number | boolean>
): void {
  posthogBrowser.registerBrowserAnalyticsContext(properties);
}

export function captureBrowserEvent(
  name: string,
  properties?: Record<string, string | number | boolean>
): void {
  posthogBrowser.captureBrowserEvent(name, properties);
}

export function optOutBrowserCapturing(): void {
  posthogBrowser.optOutBrowserCapturing();
}

export function optInBrowserCapturing(): void {
  posthogBrowser.optInBrowserCapturing();
}

export function isBrowserAnalyticsInitialized(): boolean {
  return posthogBrowser.isBrowserAnalyticsInitialized();
}
