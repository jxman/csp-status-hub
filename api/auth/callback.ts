import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseCookies } from '../_lib/cookies.js';
import { createSessionCookie } from '../_lib/session.js';

const CLEAR_OAUTH_COOKIES = [
  'oauth_state=; Max-Age=0; Path=/',
  'oauth_nonce=; Max-Age=0; Path=/',
  'oauth_code_verifier=; Max-Age=0; Path=/',
];

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const base = process.env.APP_BASE_URL ?? '';
  const cookies = parseCookies(req.headers.cookie);
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;

  if (!code || !state || state !== cookies.oauth_state) {
    res.setHeader('Set-Cookie', CLEAR_OAUTH_COOKIES);
    res.redirect(302, `${base}/admin?error=1`);
    return;
  }

  try {
    const redirectUri = `${base}/api/auth/callback`;
    const tokenRes = await fetch('https://api.vercel.com/login/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.VERCEL_OAUTH_CLIENT_ID!,
        client_secret: process.env.VERCEL_OAUTH_CLIENT_SECRET!,
        code,
        code_verifier: cookies.oauth_code_verifier ?? '',
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${tokenRes.status}`);
    }

    const tokenData = (await tokenRes.json()) as { id_token: string };
    const claims = decodeJwtPayload(tokenData.id_token);

    if (claims.nonce !== cookies.oauth_nonce) {
      throw new Error('Nonce mismatch');
    }

    const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
    const allowedEmail = process.env.ADMIN_EMAIL?.toLowerCase();

    if (!email || !allowedEmail || email !== allowedEmail) {
      res.setHeader('Set-Cookie', CLEAR_OAUTH_COOKIES);
      res.redirect(302, `${base}/admin?error=forbidden`);
      return;
    }

    const secure = base.startsWith('https') ? '; Secure' : '';
    res.setHeader('Set-Cookie', [
      ...CLEAR_OAUTH_COOKIES,
      `admin_session=${createSessionCookie(email)}; Max-Age=${7 * 24 * 60 * 60}; Path=/; HttpOnly; SameSite=Lax${secure}`,
    ]);
    res.redirect(302, `${base}/admin`);
  } catch (err) {
    console.error('auth callback error', err);
    res.setHeader('Set-Cookie', CLEAR_OAUTH_COOKIES);
    res.redirect(302, `${base}/admin?error=1`);
  }
}
