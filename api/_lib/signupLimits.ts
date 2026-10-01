import { createHash } from 'node:crypto';
import { redis } from './redis.js';

// Abuse limits for the public sign-up form (POST /api/subscribe). These
// replaced Vercel BotID, whose browser challenge is blocked by corporate
// proxies like Zscaler — the network most of this dashboard's audience sits
// behind — so real users were getting 403s.
//
// Double opt-in already means a bot can't subscribe anyone; the only real
// risk is the form being used to send confirmation emails. These limits bound
// exactly that:
//   - per address: stops anyone flooding one inbox
//   - global per day: keeps sign-up mail well inside Resend's Free plan
//     (100 emails/day, shared with the outage alerts that matter more)
// Deliberately no per-IP limit: Zscaler sends a whole company's traffic out
// through a few shared egress IPs, so it would throttle colleagues together.
export const MAX_SIGNUPS_PER_EMAIL_PER_DAY = 3;
export const MAX_SIGNUPS_PER_DAY = 30;

const DAY_SECONDS = 24 * 60 * 60;

// Hashed so Redis never holds subscriber email addresses.
function emailKey(normalizedEmail: string): string {
  return `signup:email:${createHash('sha256').update(normalizedEmail).digest('hex')}`;
}

function globalKey(now: Date): string {
  return `signup:day:${now.toISOString().slice(0, 10)}`;
}

export type SignupLimitResult = { allowed: true } | { allowed: false; reason: 'email' | 'global' };

// Counts this attempt and reports whether it may send a confirmation email.
// Per-address is checked first so a blocked address doesn't use up the
// global budget. Fails open on a Redis error: a Redis outage shouldn't
// stop real sign-ups, and double opt-in still applies.
export async function checkSignupLimits(normalizedEmail: string): Promise<SignupLimitResult> {
  try {
    const perEmail = await redis.incr(emailKey(normalizedEmail));
    if (perEmail === 1) await redis.expire(emailKey(normalizedEmail), DAY_SECONDS);
    if (perEmail > MAX_SIGNUPS_PER_EMAIL_PER_DAY) return { allowed: false, reason: 'email' };

    const key = globalKey(new Date());
    const today = await redis.incr(key);
    if (today === 1) await redis.expire(key, 2 * DAY_SECONDS);
    if (today > MAX_SIGNUPS_PER_DAY) return { allowed: false, reason: 'global' };

    return { allowed: true };
  } catch (err) {
    console.error('[subscribe] signup limit check failed — allowing request', err);
    return { allowed: true };
  }
}
