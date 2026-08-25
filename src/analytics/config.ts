const DEFAULT_POSTHOG_KEY = 'phc_mejq4ZZ8jTNZPiusjh7vHyPzWYinzsDwVJW43SM5FEcg';
const DEFAULT_API_HOST = 'https://a.alisait.com';
const DEFAULT_UI_HOST = 'https://eu.posthog.com';

function envTruthy(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function isPostHogDisabledByEnv(): boolean {
  return envTruthy('POSTHOG_DISABLED');
}

export function isAnalyticsDisabledByEnv(): boolean {
  return envTruthy('ANALYTICS_DISABLED') || isPostHogDisabledByEnv();
}

export function resolvePostHogKey(): string {
  return process.env.POSTHOG_KEY?.trim() || DEFAULT_POSTHOG_KEY;
}

export function resolvePostHogApiHost(): string {
  return process.env.POSTHOG_API_HOST?.trim() || DEFAULT_API_HOST;
}

export function resolvePostHogUiHost(): string {
  return process.env.POSTHOG_UI_HOST?.trim() || DEFAULT_UI_HOST;
}

export function hasPostHogKey(): boolean {
  return resolvePostHogKey().length > 0;
}

export function hasAnalyticsKey(): boolean {
  return hasPostHogKey();
}
