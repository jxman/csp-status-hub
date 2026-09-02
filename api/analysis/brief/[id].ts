// Content-addressed, immutable read for a single incident_analysis row —
// the companion to GET /api/analysis/latest (see that file's header comment
// for why these two are split). A row's content never changes once
// finalized: analysisPipeline.ts INSERTs the row with status='complete' and
// the text briefs already set, then best-effort backfills the two PDF URLs
// with a COALESCE UPDATE shortly after. So once that backfill has had time
// to land (or already has), this id's response can be cached forever — at
// Vercel's edge and in the requesting browser — with zero risk of serving
// stale content, because a "new" version of a brief is always a new row
// (and therefore a new id, fetched via a fresh /api/analysis/latest pointer)
// rather than a mutation of this one.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../../_lib/db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The PDF backfill normally lands within seconds of the row's INSERT (see
// analysisPipeline.ts). This bounds how long a *just-created* row is cached
// only briefly (in case the PDF step is still in flight) before being
// treated as permanently finalized even if the PDFs never showed up —
// otherwise a row whose PDF step failed outright would poll short-cache
// forever.
const FINALIZE_GRACE_MS = 5 * 60 * 1000;

interface BriefContent {
  id: string;
  triggerEvent: string;
  technicalBrief: string;
  executiveBrief: string;
  pdfTechnicalUrl: string | null;
  pdfExecutiveUrl: string | null;
  model: string;
  createdAt: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { id } = req.query;
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    res.status(400).json({ error: 'Missing or invalid id' });
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
      // Not found (bad id) or not yet in a state worth caching — never
      // immutable, since a 'pending'/'failed' row isn't this endpoint's
      // concern and a missing id might just not exist.
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

    const brief: BriefContent = {
      id: row.id as string,
      triggerEvent: row.trigger_event as string,
      technicalBrief: row.technical_brief as string,
      executiveBrief: row.executive_brief as string,
      pdfTechnicalUrl: row.pdf_technical_url as string | null,
      pdfExecutiveUrl: row.pdf_executive_url as string | null,
      model: row.model as string,
      createdAt: row.created_at as string,
    };
    res.status(200).json(brief);
  } catch (err) {
    console.error('[analysis/brief] query failed', { id }, err);
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
    res.status(500).json({ error: 'Internal error' });
  }
}
