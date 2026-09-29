import { redis } from './redis.js';
import type { Incident, Provider } from '../../src/types/status.js';

// Azure's feed simply drops an incident once it clears — unlike AWS/GCP/OCI,
// there's no resolved entry left to read, so the dashboard's "Recently
// resolved" section never showed Azure incidents. check-status.ts records
// each Azure incident here at the moment it vanishes from the feed (using the
// last full Incident it saw), and api/status/azure.ts merges these back into
// its response for RESOLVED_RETENTION_MS after resolution — matching the 24h
// window the other three fetchers already apply to their own resolved items.
export const RESOLVED_RETENTION_MS = 24 * 60 * 60 * 1000;

function resolvedKey(provider: Provider): string {
  return `resolved:${provider}`;
}

function prune(store: Record<string, Incident>, now: number): Record<string, Incident> {
  return Object.fromEntries(
    Object.entries(store).filter(([, inc]) => now - new Date(inc.endTime ?? inc.updatedAt).getTime() < RESOLVED_RETENTION_MS)
  );
}

// `incidents` are the last-seen active snapshots; endTime is stamped as "now"
// since the feed gives no resolution time — check-status runs every 5 min, so
// this is at most one tick late.
export async function recordResolvedIncidents(provider: Provider, incidents: Incident[]): Promise<void> {
  if (incidents.length === 0) return;
  const now = Date.now();
  const resolvedAt = new Date(now).toISOString();
  const existing = (await redis.get<Record<string, Incident>>(resolvedKey(provider))) ?? {};
  const store = prune(existing, now);
  for (const inc of incidents) {
    store[inc.id] = { ...inc, status: 'resolved', endTime: resolvedAt, updatedAt: resolvedAt };
  }
  // Key-level TTL is just a backstop so an idle store eventually disappears;
  // per-incident expiry is enforced by prune().
  await redis.set(resolvedKey(provider), store, { px: RESOLVED_RETENTION_MS });
}

export async function getRecentlyResolvedIncidents(provider: Provider): Promise<Incident[]> {
  const store = (await redis.get<Record<string, Incident>>(resolvedKey(provider))) ?? {};
  return Object.values(prune(store, Date.now()));
}
