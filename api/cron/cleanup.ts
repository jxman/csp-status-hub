import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../_lib/db.js';
import { HISTORY_RETENTION_DAYS } from '../_lib/incidentHistory.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.CRON_SECRET) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  // 7-day purge of never-confirmed rows — avoids an unbounded junk table
  // from bots/typos (Section 4).
  const stalePending = await sql`
    DELETE FROM subscribers
    WHERE status = 'pending_confirmation' AND created_at < now() - INTERVAL '7 days'
    RETURNING id
  `;

  // 90-day purge of unsubscribed rows — data minimization (14.6).
  const staleUnsubscribed = await sql`
    DELETE FROM subscribers
    WHERE status = 'unsubscribed' AND unsubscribed_at < now() - INTERVAL '90 days'
    RETURNING id
  `;

  // Past-incidents retention window (see incidentHistory.ts).
  const staleHistory = await sql`
    DELETE FROM incident_history
    WHERE resolved_at < now() - make_interval(days => ${HISTORY_RETENTION_DAYS})
    RETURNING provider
  `;

  res.status(200).json({
    checkedAt: new Date().toISOString(),
    deletedPending: stalePending.length,
    deletedUnsubscribed: staleUnsubscribed.length,
    deletedHistory: staleHistory.length,
  });
}
