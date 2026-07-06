import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { sendConfirmationEmail } from '../../_lib/email.js';

const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) {
    res.status(400).json({ error: 'Missing id' });
    return;
  }

  if (req.method === 'DELETE') {
    await sql`DELETE FROM subscribers WHERE id = ${id}`;
    res.status(200).json({ message: 'Deleted' });
    return;
  }

  if (req.method === 'PATCH') {
    const { action } = (req.body ?? {}) as { action?: unknown };

    if (action === 'force_unsubscribe') {
      await sql`
        UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = now()
        WHERE id = ${id}
      `;
      res.status(200).json({ message: 'Unsubscribed' });
      return;
    }

    if (action === 'resend_confirmation') {
      const rows = await sql`
        SELECT name, email, status FROM subscribers WHERE id = ${id}
      `;
      if (rows.length === 0) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      if (rows[0].status !== 'pending_confirmation') {
        res.status(400).json({ error: 'Subscriber is not pending confirmation' });
        return;
      }

      const confirmToken = randomBytes(32).toString('hex');
      const confirmTokenExpiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString();
      await sql`
        UPDATE subscribers
        SET confirm_token = ${confirmToken}, confirm_token_expires_at = ${confirmTokenExpiresAt}
        WHERE id = ${id}
      `;

      const confirmUrl = `${process.env.APP_BASE_URL}/api/subscribe/confirm?token=${confirmToken}`;
      await sendConfirmationEmail(rows[0].email, rows[0].name, confirmUrl);

      res.status(200).json({ message: 'Confirmation email resent' });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
