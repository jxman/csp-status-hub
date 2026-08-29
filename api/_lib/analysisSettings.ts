// Live-tunable settings for the Incident Briefing Engine (see README.md's
// Alerts & Admin section, Phase 4). Both knobs are Redis overrides that
// beat a safe default without a redeploy, following the same pattern
// api/analysis/run.ts established in Phase 1 for the debounce interval.
import { redis } from './redis.js';
import type { Provider } from '../../src/types/status.js';

export const DEBOUNCE_SETTING_KEY = 'settings:analysis-debounce-minutes';
export const DISABLED_PROVIDERS_KEY = 'settings:analysis-disabled-providers';
export const DEFAULT_DEBOUNCE_MINUTES = 30;
export const ALL_PROVIDERS: Provider[] = ['aws', 'azure', 'gcp', 'oci'];

export async function getDebounceMinutes(): Promise<number> {
  try {
    const override = await redis.get<number>(DEBOUNCE_SETTING_KEY);
    if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
      return override;
    }
  } catch (err) {
    console.error('[analysisSettings] failed to read live debounce override, falling back to env default', err);
  }
  const envValue = Number(process.env.ANALYSIS_DEBOUNCE_MINUTES);
  return Number.isFinite(envValue) && envValue >= 0 ? envValue : DEFAULT_DEBOUNCE_MINUTES;
}

export async function setDebounceOverride(minutes: number): Promise<void> {
  await redis.set(DEBOUNCE_SETTING_KEY, minutes);
}

export async function clearDebounceOverride(): Promise<void> {
  await redis.del(DEBOUNCE_SETTING_KEY);
}

// Fails open (nothing disabled) on a Redis error — a kill switch that can't
// be read should never silently stop analysis for every provider; the
// downside of failing open is a bit of extra Bedrock spend, which is far
// less disruptive than analysis going dark whenever Redis has a hiccup.
export async function getDisabledProviders(): Promise<Set<Provider>> {
  try {
    const list = await redis.get<Provider[]>(DISABLED_PROVIDERS_KEY);
    if (Array.isArray(list)) return new Set(list.filter((p) => ALL_PROVIDERS.includes(p)));
  } catch (err) {
    console.error('[analysisSettings] failed to read disabled-providers list, failing open (nothing disabled)', err);
  }
  return new Set();
}

export async function setDisabledProviders(providers: Provider[]): Promise<void> {
  await redis.set(DISABLED_PROVIDERS_KEY, providers);
}
