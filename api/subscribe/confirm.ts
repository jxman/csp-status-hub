import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { sql } from '../_lib/db.js';
import { sendWelcomeEmail } from '../_lib/email.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = typeof req.query.token === 'string' ? req.query.token : null;
  const base = process.env.APP_BASE_URL ?? '';

  if (!token) {
    res.redirect(302, `${base}/?confirm=error`);
    return;
  }

  try {
    const rows = await sql`
      SELECT id, name, email, status, pending_providers FROM subscribers
      WHERE confirm_token = ${token}
        AND confirm_token_expires_at > now()
    `;

    if (rows.length === 0) {
      res.redirect(302, `${base}/?confirm=error`);
      return;
    }

    const row = rows[0];

    if (row.status === 'pending_confirmation') {
      const manageToken = randomBytes(32).toString('hex');
      await sql`
        UPDATE subscribers
        SET status = 'confirmed',
            email_verified_at = now(),
            confirm_token = NULL,
            confirm_token_expires_at = NULL,
            manage_token = ${manageToken}
        WHERE id = ${row.id}
      `;

      const manageUrl = `${base}/manage?token=${manageToken}`;
      const unsubscribeUrl = `${base}/api/subscribe/unsubscribe?token=${manageToken}`;
      await sendWelcomeEmail(row.email, row.name, manageUrl, unsubscribeUrl);

      res.redirect(302, `${base}/?confirm=success`);
      return;
    }

    if (row.status === 'confirmed' && row.pending_providers) {
      await sql`
        UPDATE subscribers
        SET providers = pending_providers,
            pending_providers = NULL,
            confirm_token = NULL,
            confirm_token_expires_at = NULL,
            updated_at = now()
        WHERE id = ${row.id}
      `;

      res.redirect(302, `${base}/?confirm=updated`);
      return;
    }

    res.redirect(302, `${base}/?confirm=error`);
  } catch (err) {
    console.error('confirm error', err);
    res.redirect(302, `${base}/?confirm=error`);
  }
}
