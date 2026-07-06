import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseCookies } from './cookies.js';
import { verifySessionCookie } from './session.js';

export function requireAdmin(req: VercelRequest, res: VercelResponse): { email: string } | null {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionCookie(cookies.admin_session);
  if (!session) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return session;
}
