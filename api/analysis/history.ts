// Public read endpoint for the Incident Briefing Engine (see README.md's
// Alerts & Admin section). Unauthenticated — the whole dashboard is public
// by design, same as every other status endpoint. Serves both "latest
// brief" and "version history" from one query: an incident accumulates one
// incident_analysis row per trigger event (new -> content_changed x N ->
// resolved), and the frontend fetches the small recent tail once per panel
// expand rather than round-tripping per version.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../_lib/db.js';
import type { Provider } from '../../src/types/status.js';

const VALID_PROVIDERS: Provider[] = ['aws', 'azure', 'gcp', 'oci'];

interface BriefVersion {
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
      SELECT id, trigger_event, technical_brief, executive_brief, pdf_technical_url, pdf_executive_url, model, created_at
      FROM incident_analysis
      WHERE provider = ${provider} AND incident_id = ${incidentId} AND status = 'complete'
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const versions: BriefVersion[] = rows.map((row) => ({
      id: row.id as string,
      triggerEvent: row.trigger_event as string,
      technicalBrief: row.technical_brief as string,
      executiveBrief: row.executive_brief as string,
      pdfTechnicalUrl: row.pdf_technical_url as string | null,
      pdfExecutiveUrl: row.pdf_executive_url as string | null,
      model: row.model as string,
      createdAt: row.created_at as string,
    }));

    res.setHeader(
      'Cache-Control',
      versions.length > 0 ? 's-maxage=60, stale-while-revalidate=30' : 's-maxage=20, stale-while-revalidate=10'
    );
    res.status(200).json({ provider, incidentId, versions });
  } catch (err) {
    console.error(`[analysis/history] query failed for ${provider}/${incidentId}`, err);
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
    res.status(200).json({ provider, incidentId, versions: [] });
  }
}
