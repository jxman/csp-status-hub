// Public read endpoint for the Incident Briefing Engine (see README.md's
// Alerts & Admin section). Unauthenticated — the whole dashboard is public
// by design, same as every other status endpoint.
//
// Combines two logically distinct reads into one function (Vercel Hobby
// caps deployments at 12 Serverless Functions — see analysis-admin.ts's
// header comment for the same reasoning applied elsewhere in this repo):
//
//   ?provider=&incidentId=  → "pointer" mode: the most recent complete
//     incident_analysis row's {id, createdAt} for that incident. A mutable
//     pointer that can only advance once per analysis-debounce interval
//     (30 min by default — see analysisSettings.ts), so it's cheap to query
//     and cacheable for minutes.
//
//   ?id=<uuid>               → "content" mode: the full brief for one
//     specific, immutable row. incident_analysis rows never change once
//     status='complete' (analysisPipeline.ts INSERTs the row, then only
//     best-effort backfills the two PDF URLs via a COALESCE UPDATE), so
//     this can be cached at the edge — and in the browser — for a year.
//
// useIncidentBrief.ts fetches the pointer, then the content behind its id.
// Once any visitor has ever loaded a given brief id, every later view (any
// visitor, any reload, for the rest of that incident's life) resolves from
// cache with no Postgres query at all — see the "Pointer/content split"
// entry in README.md's Alerts & Admin section for why this split exists.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../_lib/db.js';
import type { Provider } from '../../src/types/status.js';

const VALID_PROVIDERS: Provider[] = ['aws', 'azure', 'gcp', 'oci'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The PDF backfill normally lands within seconds of the row's INSERT (see
// analysisPipeline.ts). This bounds how long a *just-created* row is cached
// only briefly (in case the PDF step is still in flight) before being
// treated as permanently finalized even if the PDFs never showed up —
// otherwise a row whose PDF step failed outright would poll short-cache
// forever.
const FINALIZE_GRACE_MS = 5 * 60 * 1000;

interface BriefPointer {
  id: string;
  createdAt: string;
}

async function servePointer(req: VercelRequest, res: VercelResponse) {
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
    console.error('[analysis/latest] pointer query failed', { provider, incidentId }, err);
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
    res.status(200).json({ provider, incidentId, pointer: null });
  }
}

async function serveContent(req: VercelRequest, res: VercelResponse, id: string) {
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  try {
    const rows = await sql`
      SELECT id, trigger_event, technical_brief, executive_brief, pdf_technical_url, pdf_executive_url, model, created_at
      FROM incident_analysis
      WHERE id = ${id} AND status = 'complete'
    `;

    const [row] = rows;
    if (!row || row.technical_brief == null || row.executive_brief == null) {
      res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
      res.status(404).json({ error: 'Brief not found' });
      return;
    }

    const ageMs = Date.now() - new Date(row.created_at as string).getTime();
    const pdfsFilledIn = row.pdf_technical_url != null && row.pdf_executive_url != null;
    const finalized = pdfsFilledIn || ageMs > FINALIZE_GRACE_MS;

    res.setHeader(
      'Cache-Control',
      finalized ? 'public, s-maxage=31536000, immutable' : 's-maxage=15, stale-while-revalidate=15'
    );
    res.status(200).json({
      id: row.id as string,
      triggerEvent: row.trigger_event as string,
      technicalBrief: row.technical_brief as string,
      executiveBrief: row.executive_brief as string,
      pdfTechnicalUrl: row.pdf_technical_url as string | null,
      pdfExecutiveUrl: row.pdf_executive_url as string | null,
      model: row.model as string,
      createdAt: row.created_at as string,
    });
  } catch (err) {
    console.error('[analysis/latest] content query failed', { id }, err);
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
    res.status(500).json({ error: 'Internal error' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { id } = req.query;
  if (typeof id === 'string') {
    await serveContent(req, res, id);
    return;
  }

  await servePointer(req, res);
}
