import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();

// Replaces the old `provider_status_snapshot` Postgres table (see
// scripts/db/003_provider_status_snapshot.sql, 005_incident_titles.sql).
// That table was read/written on every check-status cron tick (every 5 min,
// 24/7), which kept the Neon compute from ever autosuspending and blew
// through the Free plan's 100 CU-hr/month limit. Postgres is still used for
// `subscribers` and `notification_log`, which are only touched when an
// incident actually starts/resolves — see docs/ALERTS-DESIGN.md.
export interface ProviderSnapshot {
  overallStatus: string;
  activeIncidentIds: string[];
  activeIncidentTitles: Record<string, string>;
  activeIncidentRegions: Record<string, string[]>;
  lastCheckedAt: string;
  rawSignature: string;
}

export function snapshotKey(provider: string): string {
  return `snapshot:${provider}`;
}
