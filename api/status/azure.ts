import type { VercelRequest, VercelResponse } from '@vercel/node';

// Phase 2: implement Azure Atom feed fetch + parse + normalize
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(501).json({ error: 'Azure proxy not yet implemented (Phase 2)' });
}
