import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { sql } from '../_lib/db.js';
import { sendWelcomeEmail } from '../_lib/email.js';

const VALID_PROVIDERS = new Set(['aws', 'azure', 'gcp', 'oci', 'all']);

async function confirm(req: VercelRequest, res: VercelResponse) {
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
      const unsubscribeUrl = `${base}/manage?token=${manageToken}&action=unsubscribe`;
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

async function manage(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const token = typeof req.query.token === 'string' ? req.query.token : null;
    if (!token) {
      res.status(400).json({ error: 'Missing token' });
      return;
    }

    const rows = await sql`
      SELECT name, email, providers FROM subscribers
      WHERE manage_token = ${token} AND status = 'confirmed'
    `;

    if (rows.length === 0) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.status(200).json(rows[0]);
    return;
  }

  if (req.method === 'POST') {
    const { token, providers } = (req.body ?? {}) as { token?: unknown; providers?: unknown };

    if (typeof token !== 'string' || !token) {
      res.status(400).json({ error: 'Missing token' });
      return;
    }
    if (
      !Array.isArray(providers) ||
      providers.length === 0 ||
      !providers.every((p) => typeof p === 'string' && VALID_PROVIDERS.has(p))
    ) {
      res.status(400).json({ error: 'Select at least one valid provider' });
      return;
    }

    const result = await sql`
      UPDATE subscribers
      SET providers = ${providers}, updated_at = now()
      WHERE manage_token = ${token} AND status = 'confirmed'
      RETURNING id
    `;

    if (result.length === 0) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.status(200).json({ message: 'Updated' });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

async function unsubscribe(req: VercelRequest, res: VercelResponse) {
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

// Consolidates confirm/manage/unsubscribe into one function via Vercel's
// dynamic-segment routing (api/subscribe/[action].ts matches
// /api/subscribe/<anything>, no vercel.json rewrite needed) — keeps the
// Hobby-plan 12-function cap from being tripped by every new endpoint.
// api/subscribe/index.ts (POST create) stays separate since it matches the
// bare /api/subscribe path, not a sub-path.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  switch (req.query.action) {
    case 'confirm': return confirm(req, res);
    case 'manage': return manage(req, res);
    case 'unsubscribe': return unsubscribe(req, res);
    default:
      res.status(404).json({ error: 'Not found' });
  }
}
