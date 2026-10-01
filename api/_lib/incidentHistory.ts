import { sql } from './db.js';
import type { Incident, Provider } from '../../src/types/status.js';

// How long resolved incidents stay in incident_history (scripts/db/
// 008_incident_history.sql). Enforced by api/cron/cleanup.ts and used as the
// upper bound of /api/incidents/history's window.
export const HISTORY_RETENTION_DAYS = 90;

// Builds the Incident stored for a resolved id. `snapshot` is the last-seen
// active copy (from check-status's Redis snapshot) and carries the real
// startTime/severity; `resolvedCopy` is the provider's own resolved entry
// from this fetch, when it has one (AWS/GCP/OCI — Azure just drops the
// entry), and carries the real end time and final "resolved" text. The
// fetchers' resolved entries can't be used alone: AWS sets their startTime
// to the resolution time and all three report severity 'low'.
export function buildResolvedIncident(
  snapshot: Incident | undefined,
  resolvedCopy: Incident | undefined,
  detectedAt: string
): Incident | null {
  const base = snapshot ?? resolvedCopy;
  if (!base) return null;
  return {
    ...base,
    title: resolvedCopy?.title ?? base.title,
    detailUrl: resolvedCopy?.detailUrl ?? base.detailUrl,
    latestUpdate: resolvedCopy?.latestUpdate || base.latestUpdate,
    status: 'resolved',
    endTime: resolvedCopy?.endTime ?? detectedAt,
    updatedAt: resolvedCopy?.updatedAt ?? detectedAt,
  };
}

export async function recordIncidentHistory(provider: Provider, incidents: Incident[]): Promise<void> {
  for (const inc of incidents) {
    await sql`
      INSERT INTO incident_history (provider, incident_id, title, start_time, resolved_at, snapshot)
      VALUES (${provider}, ${inc.id}, ${inc.title}, ${inc.startTime || null}, ${inc.endTime}, ${JSON.stringify(inc)}::jsonb)
      ON CONFLICT (provider, incident_id) DO UPDATE SET
        title = EXCLUDED.title,
        resolved_at = EXCLUDED.resolved_at,
        snapshot = EXCLUDED.snapshot
    `;
  }
}
