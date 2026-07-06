import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../_lib/db.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = typeof req.query.token === 'string' ? req.query.token : null;
  const base = process.env.APP_BASE_URL ?? '';

  if (!token) {
    res.redirect(302, `${base}/?unsubscribed=error`);
    return;
  }

  try {
    // Idempotent — matches only currently-confirmed rows so re-hitting this
    // link (e.g. an email scanner prefetching it) after the first click is a no-op.
    await sql`
      UPDATE subscribers
      SET status = 'unsubscribed', unsubscribed_at = now()
      WHERE manage_token = ${token} AND status = 'confirmed'
    `;

    res.redirect(302, `${base}/?unsubscribed=1`);
  } catch (err) {
    console.error('unsubscribe error', err);
    res.redirect(302, `${base}/?unsubscribed=error`);
  }
}
