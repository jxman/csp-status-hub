import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Set-Cookie', 'admin_session=; Max-Age=0; Path=/; HttpOnly');
  res.status(200).json({ message: 'Signed out' });
}
