import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { sendConfirmationEmail } from '../../_lib/email.js';

const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

interface SubscriberRow {
  id: string;
  name: string;
  email: string;
  providers: string[];
  pending_providers: string[] | null;
  status: string;
  created_at: string;
  unsubscribed_at: string | null;
}

function toCsv(rows: SubscriberRow[]): string {
  const header = ['name', 'email', 'providers', 'status', 'created_at'];
  const lines = rows.map((r) =>
    [r.name, r.email, r.providers.join('|'), r.status, r.created_at]
      .map((field) => `"${String(field).replace(/"/g, '""')}"`)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

// Handles bare GET /api/admin/subscribers (list/search/filter/CSV export) —
// folded in here, alongside the per-id DELETE/PATCH actions below, so the
// whole admin subscribers surface is one function instead of two (Vercel
// Hobby caps deployments at 12 Serverless Functions — see
// analysis-admin.ts's header comment for the same reasoning applied
// elsewhere in this repo).
async function list(req: VercelRequest, res: VercelResponse) {
  const rows = (await sql`
    SELECT id, name, email, providers, pending_providers, status, created_at, unsubscribed_at
    FROM subscribers
    ORDER BY created_at DESC
  `) as unknown as SubscriberRow[];

  const summary = {
    total: rows.length,
    confirmed: rows.filter((r) => r.status === 'confirmed').length,
    pending: rows.filter((r) => r.status === 'pending_confirmation').length,
    unsubscribed: rows.filter((r) => r.status === 'unsubscribed').length,
    byProvider: {
      aws: rows.filter((r) => r.status === 'confirmed' && (r.providers.includes('aws') || r.providers.includes('all'))).length,
      azure: rows.filter((r) => r.status === 'confirmed' && (r.providers.includes('azure') || r.providers.includes('all'))).length,
      gcp: rows.filter((r) => r.status === 'confirmed' && (r.providers.includes('gcp') || r.providers.includes('all'))).length,
      oci: rows.filter((r) => r.status === 'confirmed' && (r.providers.includes('oci') || r.providers.includes('all'))).length,
    },
  };

  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const provider = typeof req.query.provider === 'string' ? req.query.provider : null;
  const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : null;

  let filtered = rows;
  if (status) filtered = filtered.filter((r) => r.status === status);
  if (provider) filtered = filtered.filter((r) => r.providers.includes(provider) || r.providers.includes('all'));
  if (q) filtered = filtered.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));

  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
    res.status(200).send(toCsv(filtered));
    return;
  }

  res.status(200).json({ summary, subscribers: filtered });
}

async function byId(req: VercelRequest, res: VercelResponse, id: string) {
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

// Bare GET /api/admin/subscribers reaches this file via the explicit
// vercel.json rewrite (bracket routes aren't auto-wired outside Next.js,
// see README.md's Known constraints) with no :id segment, so req.query.id
// is undefined — routed to `list` below. /api/admin/subscribers/:id
// reaches it the same way, with id populated from the rewrite's named
// group, routed to `byId`.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const id = typeof req.query.id === 'string' ? req.query.id : null;
  if (!id) {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    await list(req, res);
    return;
  }

  await byId(req, res, id);
}
