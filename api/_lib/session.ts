import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sign(data: string): string {
  return createHmac('sha256', process.env.SESSION_SECRET!).update(data).digest('base64url');
}

export function createSessionCookie(email: string): string {
  const payload = JSON.stringify({ email, exp: Date.now() + SESSION_TTL_MS });
  const encoded = Buffer.from(payload).toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionCookie(value: string | undefined): { email: string } | null {
  if (!value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      email: string;
      exp: number;
    };
    if (payload.exp < Date.now()) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}
