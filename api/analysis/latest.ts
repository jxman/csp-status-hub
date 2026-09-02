// Public read endpoint for the Incident Briefing Engine (see README.md's
// Alerts & Admin section). Unauthenticated — the whole dashboard is public
// by design, same as every other status endpoint. An incident accumulates
// one incident_analysis row per trigger event (new -> content_changed x N
// -> resolved), but the dashboard only ever wants the current state of the
// incident, so this returns just the most recent complete row's *pointer*
// (id + createdAt) rather than the full run history (that's a separate
// concern, covered for admins by `GET /api/admin/analysis-admin?resource=runs`)
// — and, since Postgres 2026-09, rather than the brief content itself either.
//
// This is deliberately split from the brief content (GET /api/analysis/brief/[id]):
// "latest" is a mutable pointer that can only advance at most once per
// analysis-debounce interval (30 min by default — see analysisSettings.ts),
// so it's cheap to query and cacheable for minutes, while the brief content
// behind a given id never changes once finalized and is cached at the edge
// for a year. Splitting them means repeat/duplicate client traffic (refreshes,
// multiple visitors on the same incident, the 60s dashboard poll) resolves
// almost entirely from Vercel's edge cache instead of re-querying Neon on
// every request — see the "known constraints" thread in README.md for why
// keeping Neon compute from ever waking on a tight cadence matters here.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../_lib/db.js';
import type { Provider } from '../../src/types/status.js';

const VALID_PROVIDERS: Provider[] = ['aws', 'azure', 'gcp', 'oci'];

interface BriefPointer {
  id: string;
  createdAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { provider, incidentId } = req.query;
  if (typeof provider !== 'string' || !VALID_PROVIDERS.includes(provider as Provider)) {
    res.status(400).json({ error: 'Missing or invalid provider' });
    return;
  }
  if (typeof incidentId !== 'string' || incidentId.length === 0) {
    res.status(400).json({ error: 'Missing or invalid incidentId' });
    return;
  }

  try {
    const rows = await sql`
      SELECT id, created_at
      FROM incident_analysis
      WHERE provider = ${provider} AND incident_id = ${incidentId} AND status = 'complete'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const [row] = rows;
    const pointer: BriefPointer | null = row
      ? { id: row.id as string, createdAt: row.created_at as string }
      : null;

    // A new pointer can't appear faster than the (admin-tunable) debounce
    // interval, so 5 minutes here is generous headroom, not a staleness risk.
    // The "no brief yet" case stays short so a panel opened right as
    // generation is in flight still picks up the first brief quickly.
    res.setHeader(
      'Cache-Control',
      pointer ? 's-maxage=300, stale-while-revalidate=120' : 's-maxage=20, stale-while-revalidate=10'
    );
    res.status(200).json({ provider, incidentId, pointer });
  } catch (err) {
    console.error('[analysis/latest] query failed', { provider, incidentId }, err);
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
    res.status(200).json({ provider, incidentId, pointer: null });
  }
}
