import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { checkBotId } from 'botid/server';
import { sql } from '../_lib/db.js';
import { sendConfirmationEmail, sendUpdateConfirmationEmail } from '../_lib/email.js';

const VALID_PROVIDERS = new Set(['aws', 'azure', 'gcp', 'oci', 'all']);
const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const GENERIC_RESPONSE = { message: 'Check your email to confirm your subscription.' };

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const verification = await checkBotId();
  if (verification.isBot) {
    res.status(403).json({ error: 'Request blocked' });
    return;
  }

  const { name, email, providers } = (req.body ?? {}) as {
    name?: unknown;
    email?: unknown;
    providers?: unknown;
  };

  if (typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }
  if (typeof email !== 'string' || !isValidEmail(email)) {
    res.status(400).json({ error: 'A valid email is required' });
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

  const normalizedEmail = email.trim().toLowerCase();
  const confirmToken = randomBytes(32).toString('hex');
  const confirmTokenExpiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString();

  try {
    const existing = await sql`
      SELECT id, status, providers FROM subscribers WHERE email = ${normalizedEmail}
    `;

    if (existing.length === 0) {
      await sql`
        INSERT INTO subscribers (name, email, providers, confirm_token, confirm_token_expires_at)
        VALUES (${name.trim()}, ${normalizedEmail}, ${providers}, ${confirmToken}, ${confirmTokenExpiresAt})
      `;
      const confirmUrl = `${process.env.APP_BASE_URL}/api/subscribe/confirm?token=${confirmToken}`;
      await sendConfirmationEmail(normalizedEmail, name.trim(), confirmUrl);
    } else if (existing[0].status === 'pending_confirmation') {
      // Already pending — reissue the confirmation token instead of erroring.
      // Name isn't security-sensitive (unlike providers/email), so it updates
      // immediately rather than waiting on the re-confirmation below.
      await sql`
        UPDATE subscribers
        SET name = ${name.trim()}, confirm_token = ${confirmToken}, confirm_token_expires_at = ${confirmTokenExpiresAt}
        WHERE id = ${existing[0].id}
      `;
      const confirmUrl = `${process.env.APP_BASE_URL}/api/subscribe/confirm?token=${confirmToken}`;
      await sendConfirmationEmail(normalizedEmail, name.trim(), confirmUrl);
    } else if (existing[0].status === 'confirmed') {
      // Already confirmed. Name updates immediately (not security-sensitive).
      // Provider changes (4.1) are staged rather than applied immediately —
      // this form is unauthenticated (anyone can type anyone else's email),
      // so a provider change here must be re-verified by email.
      await sql`
        UPDATE subscribers SET name = ${name.trim()}, updated_at = now() WHERE id = ${existing[0].id}
      `;

      const sameProviders =
        JSON.stringify([...existing[0].providers].sort()) === JSON.stringify([...providers].sort());
      if (!sameProviders) {
        await sql`
          UPDATE subscribers
          SET pending_providers = ${providers}, confirm_token = ${confirmToken}, confirm_token_expires_at = ${confirmTokenExpiresAt}
          WHERE id = ${existing[0].id}
        `;
        const confirmUrl = `${process.env.APP_BASE_URL}/api/subscribe/confirm?token=${confirmToken}`;
        await sendUpdateConfirmationEmail(normalizedEmail, name.trim(), confirmUrl);
      }
    } else if (existing[0].status === 'unsubscribed') {
      // Re-signing up after unsubscribing — treat as a fresh signup, not an update.
      await sql`
        UPDATE subscribers
        SET name = ${name.trim()}, providers = ${providers}, status = 'pending_confirmation',
            confirm_token = ${confirmToken}, confirm_token_expires_at = ${confirmTokenExpiresAt},
            pending_providers = NULL, email_verified_at = NULL, unsubscribed_at = NULL
        WHERE id = ${existing[0].id}
      `;
      const confirmUrl = `${process.env.APP_BASE_URL}/api/subscribe/confirm?token=${confirmToken}`;
      await sendConfirmationEmail(normalizedEmail, name.trim(), confirmUrl);
    }

    res.status(200).json(GENERIC_RESPONSE);
  } catch (err) {
    console.error('subscribe error', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
