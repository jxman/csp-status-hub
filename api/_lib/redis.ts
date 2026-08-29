import { Redis } from '@upstash/redis';
import type { Incident } from '../../src/types/status.js';

export const redis = Redis.fromEnv();

// Replaces the old `provider_status_snapshot` Postgres table (see
// scripts/db/003_provider_status_snapshot.sql, 005_incident_titles.sql).
// That table was read/written on every check-status cron tick (every 5 min,
// 24/7), which kept the Neon compute from ever autosuspending and blew
// through the Free plan's 100 CU-hr/month limit. Postgres is still used for
// `subscribers` and `notification_log`, which are only touched when an
// incident actually starts/resolves — see README.md's Alerts & Admin section.
export interface ProviderSnapshot {
  overallStatus: string;
  activeIncidentIds: string[];
  activeIncidentTitles: Record<string, string>;
  activeIncidentRegions: Record<string, string[]>;
  // Per-incident content hash (status + latestUpdate + affectedServices +
  // affectedRegions), added for the Incident Briefing Engine (see
  // README.md's Alerts & Admin section) so check-status.ts can tell "still
  // active, nothing new to say" apart from "the vendor posted a real
  // update" for an incident whose ID hasn't changed.
  activeIncidentContentHashes: Record<string, string>;
  // Full Incident payload per active id, kept only so a *resolved* incident
  // still has something richer than a title/region pair to hand the
  // Incident Briefing Engine's closing analysis once it drops out of the
  // feed — activeIncidentTitles/activeIncidentRegions above stay as-is and
  // keep driving the (unrelated) outage-email path.
  activeIncidentSnapshots: Record<string, Incident>;
  lastCheckedAt: string;
}

export function snapshotKey(provider: string): string {
  return `snapshot:${provider}`;
}
