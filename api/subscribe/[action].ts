import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { sql } from '../_lib/db.js';
import { sendConfirmationEmail, sendUpdateConfirmationEmail, sendWelcomeEmail } from '../_lib/email.js';
import { checkSignupLimits } from '../_lib/signupLimits.js';

const VALID_PROVIDERS = new Set(['aws', 'azure', 'gcp', 'oci', 'all']);
const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Handles bare POST /api/subscribe (new sign-up / provider-change request) —
// folded in here, alongside confirm/manage/unsubscribe, so the whole
// subscribe surface is one function instead of two (see the handler's
// dispatch comment below for why that matters on Hobby).
async function create(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { name, email, providers, hpField } = (req.body ?? {}) as {
    name?: unknown;
    email?: unknown;
    providers?: unknown;
    hpField?: unknown;
  };

  // Honeypot: the form's hidden field is never visible to people (and its
  // name matches no browser autofill type), so anything in it came from a
  // form-filling bot. Answer exactly like a
  // real sign-up so the bot learns nothing, but send no email.
  if (typeof hpField === 'string' && hpField.trim() !== '') {
    console.log('[subscribe] honeypot field filled — ignoring sign-up');
    res.status(200).json({ message: 'Check your email to confirm your subscription.' });
    return;
  }

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

  // Counted after validation, so a mistyped form doesn't use up an
  // address's daily allowance (see signupLimits.ts).
  const limit = await checkSignupLimits(normalizedEmail);
  if (!limit.allowed) {
    console.log(`[subscribe] sign-up limited (${limit.reason})`);
    res.status(429).json({
      error:
        limit.reason === 'email'
          ? 'Too many sign-up attempts for this email address. Please try again tomorrow.'
          : 'Sign-ups are temporarily paused because of high volume. Please try again tomorrow.',
    });
    return;
  }
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

    res.status(200).json({ message: 'Check your email to confirm your subscription.' });
  } catch (err) {
    console.error('subscribe error', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

async function confirm(req: VercelRequest, res: VercelResponse) {
  const token = typeof req.query.token === 'string' ? req.query.token : null;
  const base = process.env.APP_BASE_URL ?? '';

  if (!token) {
    res.redirect(302, `${base}/?confirm=error`);
    return;
  }

  try {
    const rows = await sql`
      SELECT id, name, email, status, pending_providers FROM subscribers
      WHERE confirm_token = ${token}
        AND confirm_token_expires_at > now()
    `;

    if (rows.length === 0) {
      res.redirect(302, `${base}/?confirm=error`);
      return;
    }

    const row = rows[0];

    if (row.status === 'pending_confirmation') {
      const manageToken = randomBytes(32).toString('hex');
      await sql`
        UPDATE subscribers
        SET status = 'confirmed',
            email_verified_at = now(),
            confirm_token = NULL,
            confirm_token_expires_at = NULL,
            manage_token = ${manageToken}
        WHERE id = ${row.id}
      `;

      const manageUrl = `${base}/manage?token=${manageToken}`;
      const unsubscribeUrl = `${base}/manage?token=${manageToken}&action=unsubscribe`;
      await sendWelcomeEmail(row.email, row.name, manageUrl, unsubscribeUrl);

      res.redirect(302, `${base}/?confirm=success`);
      return;
    }

    if (row.status === 'confirmed' && row.pending_providers) {
      await sql`
        UPDATE subscribers
        SET providers = pending_providers,
            pending_providers = NULL,
            confirm_token = NULL,
            confirm_token_expires_at = NULL,
            updated_at = now()
        WHERE id = ${row.id}
      `;

      res.redirect(302, `${base}/?confirm=updated`);
      return;
    }

    res.redirect(302, `${base}/?confirm=error`);
  } catch (err) {
    console.error('confirm error', err);
    res.redirect(302, `${base}/?confirm=error`);
  }
}

async function manage(req: VercelRequest, res: VercelResponse) {
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

async function unsubscribe(req: VercelRequest, res: VercelResponse) {
  const token = typeof req.query.token === 'string' ? req.query.token : null;
  const base = process.env.APP_BASE_URL ?? '';

  if (!token) {
    res.redirect(302, `${base}/?unsubscribed=error`);
    return;
  }

  try {
    // Idempotent — matches only currently-confirmed rows so re-hitting this
    // link (e.g. an email scanner prefetching it) after the first click is a no-op.
    await sql`
      UPDATE subscribers
      SET status = 'unsubscribed', unsubscribed_at = now()
      WHERE manage_token = ${token} AND status = 'confirmed'
    `;

    res.redirect(302, `${base}/?unsubscribed=1`);
  } catch (err) {
    console.error('unsubscribe error', err);
    res.redirect(302, `${base}/?unsubscribed=error`);
  }
}

// Consolidates create/confirm/manage/unsubscribe into one function (Vercel
// Hobby caps deployments at 12 Serverless Functions — see
// analysis-admin.ts's header comment for the same reasoning applied
// elsewhere in this repo). Sub-paths (/api/subscribe/confirm etc.) reach
// this file via Vercel's dynamic-segment routing; the bare POST
// /api/subscribe path — no :action segment, so req.query.action is
// undefined — reaches it via the explicit vercel.json rewrite (bracket
// routes aren't auto-wired outside Next.js, see README.md's Known
// constraints), landing on the `create` branch below.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  switch (req.query.action) {
    case undefined: return create(req, res);
    case 'confirm': return confirm(req, res);
    case 'manage': return manage(req, res);
    case 'unsubscribe': return unsubscribe(req, res);
    default:
      res.status(404).json({ error: 'Not found' });
  }
}
