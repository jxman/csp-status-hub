import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes, createHash } from 'node:crypto';
import { parseCookies } from '../_lib/cookies.js';
import { createSessionCookie } from '../_lib/session.js';

function randomString(): string {
  return randomBytes(32).toString('base64url');
}

const CLEAR_OAUTH_COOKIES = [
  'oauth_state=; Max-Age=0; Path=/',
  'oauth_nonce=; Max-Age=0; Path=/',
  'oauth_code_verifier=; Max-Age=0; Path=/',
];

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function authorize(_req: VercelRequest, res: VercelResponse) {
  const base = process.env.APP_BASE_URL ?? '';
  const secure = base.startsWith('https') ? '; Secure' : '';

  const state = randomString();
  const nonce = randomString();
  const codeVerifier = randomString();
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const cookieOpts = `Max-Age=600; Path=/; HttpOnly; SameSite=Lax${secure}`;
  res.setHeader('Set-Cookie', [
    `oauth_state=${state}; ${cookieOpts}`,
    `oauth_nonce=${nonce}; ${cookieOpts}`,
    `oauth_code_verifier=${codeVerifier}; ${cookieOpts}`,
  ]);

  const params = new URLSearchParams({
    client_id: process.env.VERCEL_OAUTH_CLIENT_ID!,
    redirect_uri: `${base}/api/auth/callback`,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    response_type: 'code',
    scope: 'openid email profile',
  });

  res.redirect(302, `https://vercel.com/oauth/authorize?${params.toString()}`);
}

async function callback(req: VercelRequest, res: VercelResponse) {
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

async function signout(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Set-Cookie', 'admin_session=; Max-Age=0; Path=/; HttpOnly');
  res.status(200).json({ message: 'Signed out' });
}

// Consolidates authorize/callback/signout into one function via Vercel's
// dynamic-segment routing (api/auth/[action].ts matches /api/auth/<anything>
// with no vercel.json rewrite needed) — kept the Hobby-plan 12-function cap
// from being tripped by every new endpoint. External URLs are unchanged, which
// matters here since redirect_uri is registered with the Vercel OAuth app.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  switch (req.query.action) {
    case 'authorize': return authorize(req, res);
    case 'callback': return callback(req, res);
    case 'signout': return signout(req, res);
    default:
      res.status(404).json({ error: 'Not found' });
  }
}
