import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from '../_lib/db.js';

const VALID_PROVIDERS = new Set(['aws', 'azure', 'gcp', 'oci', 'all']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
