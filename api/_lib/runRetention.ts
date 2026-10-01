import { sql } from './db.js';
import { HISTORY_RETENTION_DAYS } from './incidentHistory.js';

// Retention rules for incident_analysis runs, shared by the admin Run
// History badges and its "Clean up unused" action so the two can never
// disagree. Rules are evaluated per run, not per incident: the dashboard
// only ever shows an incident's newest complete run (see
// api/analysis/latest.ts and api/incidents/history.ts), so older complete
// runs are unreachable even while the incident itself is still linked.
//
// Kept:
//   active      newest complete run of an incident on the live dashboard
//   past        newest complete run of an incident in incident_history
//               within HISTORY_RETENTION_DAYS (Past incidents / Recently
//               resolved link to it)
//   recent      newest complete run of an incident with any run in the last
//               24h — safety net for a Recently resolved incident whose
//               best-effort history row was never written
//   replacing   an older complete run whose replacement is under
//               SUPERSEDED_GRACE old. Edge caches can keep serving the old
//               brief id for a while: the pointer for ~7 min, and Past
//               incidents' history response for 1h.
//   failed_kept a failed run with no later complete run, under
//               FAILED_RETENTION_DAYS old — the error message is the only
//               record of what went wrong
// Removed by cleanup:
//   superseded      an older complete run, past the grace window
//   failed_resolved a failed run that was later retried successfully, or is
//                   older than FAILED_RETENTION_DAYS
//   unlinked        newest complete run of an incident the dashboard no
//                   longer links to
export const SUPERSEDED_GRACE = '2 hours';
export const FAILED_RETENTION_DAYS = 30;

export type RunLinkKind =
  | 'active' | 'past' | 'recent' | 'replacing' | 'failed_kept'
  | 'superseded' | 'failed_resolved' | 'unlinked';

export const DELETABLE_KINDS: RunLinkKind[] = ['superseded', 'failed_resolved', 'unlinked'];

// $1 = active incident keys ("provider:incidentId"), $2 = history retention
// days, $3 = failed retention days. Yields (id, link, link_until).
const CLASSIFY_CTE = `
  classified AS (
    SELECT a.id,
      CASE
        WHEN a.status <> 'complete' THEN
          CASE WHEN later.id IS NOT NULL OR a.created_at < now() - make_interval(days => $3)
               THEN 'failed_resolved' ELSE 'failed_kept' END
        WHEN newest.id <> a.id THEN
          CASE WHEN newest.created_at < now() - INTERVAL '${SUPERSEDED_GRACE}'
               THEN 'superseded' ELSE 'replacing' END
        WHEN a.provider || ':' || a.incident_id = ANY($1::text[]) THEN 'active'
        WHEN h.resolved_at IS NOT NULL THEN 'past'
        WHEN recent.id IS NOT NULL THEN 'recent'
        ELSE 'unlinked'
      END AS link,
      h.resolved_at + make_interval(days => $2) AS link_until
    FROM incident_analysis a
    LEFT JOIN LATERAL (
      SELECT c.id, c.created_at FROM incident_analysis c
      WHERE c.provider = a.provider AND c.incident_id = a.incident_id AND c.status = 'complete'
      ORDER BY c.created_at DESC, c.id DESC LIMIT 1
    ) newest ON true
    LEFT JOIN LATERAL (
      SELECT c.id FROM incident_analysis c
      WHERE c.provider = a.provider AND c.incident_id = a.incident_id AND c.status = 'complete'
        AND c.created_at > a.created_at
      LIMIT 1
    ) later ON true
    LEFT JOIN LATERAL (
      SELECT r.id FROM incident_analysis r
      WHERE r.provider = a.provider AND r.incident_id = a.incident_id
        AND r.created_at > now() - INTERVAL '24 hours'
      LIMIT 1
    ) recent ON true
    LEFT JOIN incident_history h
      ON h.provider = a.provider AND h.incident_id = a.incident_id
     AND h.resolved_at > now() - make_interval(days => $2)
  )`;

function params(activeKeys: string[]) {
  return [activeKeys, HISTORY_RETENTION_DAYS, FAILED_RETENTION_DAYS];
}

export interface ClassifiedRunsResult {
  runs: Record<string, unknown>[];
  deletableCount: number;
}

// Newest 200 runs with their link classification, plus the table-wide
// count the cleanup would remove (not just within these 200).
export async function listClassifiedRuns(activeKeys: string[]): Promise<ClassifiedRunsResult> {
  const [runs, counts] = await Promise.all([
    sql.query(
      `WITH ${CLASSIFY_CTE}
       SELECT a.id, a.provider, a.incident_id, a.incident_snapshot->>'title' AS incident_title,
              a.incident_snapshot->'affectedRegions' AS affected_regions,
              a.trigger_event, a.status, a.error, a.model, a.created_at, a.pdf_technical_url, a.pdf_executive_url,
              a.input_tokens, a.output_tokens, c.link, c.link_until
       FROM incident_analysis a JOIN classified c ON c.id = a.id
       ORDER BY a.created_at DESC
       LIMIT 200`,
      params(activeKeys)
    ),
    sql.query(
      `WITH ${CLASSIFY_CTE}
       SELECT count(*)::int AS deletable FROM classified WHERE link = ANY($4::text[])`,
      [...params(activeKeys), DELETABLE_KINDS]
    ),
  ]);
  return { runs, deletableCount: (counts[0]?.deletable as number) ?? 0 };
}

// Deletes every run the rules above mark as removable, in one statement so
// classification and deletion see the same snapshot of the table.
export async function deleteUnusedRuns(activeKeys: string[]): Promise<{ pdf_technical_url: string | null; pdf_executive_url: string | null }[]> {
  const rows = await sql.query(
    `WITH ${CLASSIFY_CTE}
     DELETE FROM incident_analysis
     WHERE id IN (SELECT id FROM classified WHERE link = ANY($4::text[]))
     RETURNING pdf_technical_url, pdf_executive_url`,
    [...params(activeKeys), DELETABLE_KINDS]
  );
  return rows as { pdf_technical_url: string | null; pdf_executive_url: string | null }[];
}
