import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes, createHash } from 'node:crypto';

function randomString(): string {
  return randomBytes(32).toString('base64url');
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
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
