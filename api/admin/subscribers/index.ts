import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

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
