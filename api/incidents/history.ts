// Public read endpoint for the dashboard's collapsed "Past incidents"
// section: incidents resolved more than 24h ago and within the retention
// window (HISTORY_RETENTION_DAYS). Anything resolved in the last 24h is
// excluded because it's still shown under "Recently resolved", which comes
// straight from the provider feeds.
//
// Fetched only when a visitor expands the section, and edge-cached for an
// hour — history changes at most a few times a day — so almost every view is
// served from Vercel's CDN without waking Neon.
//
// Each item carries the incident's latest complete AI brief id (if any), so
// the card's AI Insight panel can load the brief content directly instead of
// making a per-card pointer request to /api/analysis/latest.
//
// ?cursor=<opaque> pages backwards through older incidents.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../_lib/db.js';
import { HISTORY_RETENTION_DAYS } from '../_lib/incidentHistory.js';
import type { Incident, Provider } from '../../src/types/status.js';

const PAGE_SIZE = 50;

interface Cursor {
  resolvedAt: string;
  provider: string;
  incidentId: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (typeof c.resolvedAt !== 'string' || isNaN(new Date(c.resolvedAt).getTime())) return null;
    if (typeof c.provider !== 'string' || typeof c.incidentId !== 'string') return null;
    return c;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawCursor = req.query.cursor;
  const cursor = typeof rawCursor === 'string' ? decodeCursor(rawCursor) : null;
  if (typeof rawCursor === 'string' && !cursor) {
    res.status(400).json({ error: 'Invalid cursor' });
    return;
  }

  try {
    // The cursor tuple comparison keeps paging stable when several incidents
    // share a resolved_at (e.g. Azure incidents detected in the same tick).
    const rows = await sql`
      SELECT h.provider, h.incident_id, h.resolved_at, h.snapshot, b.id AS brief_id
      FROM incident_history h
      LEFT JOIN LATERAL (
        SELECT a.id
        FROM incident_analysis a
        WHERE a.provider = h.provider AND a.incident_id = h.incident_id AND a.status = 'complete'
        ORDER BY a.created_at DESC
        LIMIT 1
      ) b ON true
      WHERE h.resolved_at < now() - INTERVAL '24 hours'
        AND h.resolved_at > now() - make_interval(days => ${HISTORY_RETENTION_DAYS})
        AND (
          ${cursor === null}
          OR (h.resolved_at, h.provider, h.incident_id) < (${cursor?.resolvedAt ?? null}::timestamptz, ${cursor?.provider ?? ''}, ${cursor?.incidentId ?? ''})
        )
      ORDER BY h.resolved_at DESC, h.provider DESC, h.incident_id DESC
      LIMIT ${PAGE_SIZE + 1}
    `;

    const page = rows.slice(0, PAGE_SIZE);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > PAGE_SIZE && last
        ? encodeCursor({
            resolvedAt: new Date(last.resolved_at as string).toISOString(),
            provider: last.provider as string,
            incidentId: last.incident_id as string,
          })
        : null;

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json({
      retentionDays: HISTORY_RETENTION_DAYS,
      incidents: page.map((row) => ({
        provider: row.provider as Provider,
        incident: row.snapshot as Incident,
        briefId: (row.brief_id as string | null) ?? null,
      })),
      nextCursor,
    });
  } catch (err) {
    console.error('[incidents/history] query failed', err);
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
    res.status(500).json({ error: 'Internal error' });
  }
}
