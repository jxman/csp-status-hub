import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import {
  sendConfirmationEmail,
  sendUpdateConfirmationEmail,
  sendWelcomeEmail,
  sendOutageNotificationEmail,
  sendResolutionNotificationEmail,
  type EmailIncident,
} from '../_lib/email.js';
import type { Provider, StatusLevel } from '../../src/types/status.js';

type TestEmailType = 'confirmation' | 'update_confirmation' | 'welcome' | 'outage' | 'resolution';

const PROVIDER_NAMES: Record<string, string> = {
  aws: 'Amazon Web Services',
  azure: 'Microsoft Azure',
  gcp: 'Google Cloud',
  oci: 'Oracle Cloud',
};

const SAMPLE_INCIDENTS: EmailIncident[] = [
  { id: 'sample-incident-1', title: 'Increased error rates for API requests', regions: ['US East (N. Virginia)'] },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { type, to, provider } = (req.body ?? {}) as {
    type?: unknown;
    to?: unknown;
    provider?: unknown;
  };

  if (typeof to !== 'string' || !EMAIL_RE.test(to)) {
    res.status(400).json({ error: 'A valid recipient email is required' });
    return;
  }

  const normalizedTo = to.trim().toLowerCase();
  // Test emails should only ever reach real, currently-confirmed subscribers —
  // not arbitrary addresses — so this is enforced here too, not just hidden
  // from the admin UI's recipient picker.
  const rows = await sql`SELECT name FROM subscribers WHERE email = ${normalizedTo} AND status = 'confirmed'`;
  if (rows.length === 0) {
    res.status(400).json({ error: 'That address is not a confirmed subscriber' });
    return;
  }
  const recipientName = rows[0].name as string;

  const providerId = typeof provider === 'string' && provider in PROVIDER_NAMES ? provider : 'aws';
  const providerName = PROVIDER_NAMES[providerId];

  const base = process.env.APP_BASE_URL || 'https://cloudstatus.synepho.com';
  const manageUrl = `${base}/manage?token=test-token`;
  const unsubscribeUrl = `${base}/manage?token=test-token&action=unsubscribe`;

  try {
    switch (type as TestEmailType) {
      case 'confirmation':
        await sendConfirmationEmail(normalizedTo, recipientName, `${base}/api/subscribe/confirm?token=test-token`);
        break;
      case 'update_confirmation':
        await sendUpdateConfirmationEmail(normalizedTo, recipientName, `${base}/api/subscribe/confirm?token=test-token`);
        break;
      case 'welcome':
        await sendWelcomeEmail(normalizedTo, recipientName, manageUrl, unsubscribeUrl);
        break;
      case 'outage':
        await sendOutageNotificationEmail(
          normalizedTo,
          recipientName,
          providerId as Provider,
          providerName,
          'outage' as StatusLevel,
          SAMPLE_INCIDENTS,
          base,
          manageUrl,
          unsubscribeUrl
        );
        break;
      case 'resolution':
        await sendResolutionNotificationEmail(
          normalizedTo,
          recipientName,
          providerId as Provider,
          providerName,
          'operational' as StatusLevel,
          SAMPLE_INCIDENTS,
          base,
          manageUrl,
          unsubscribeUrl
        );
        break;
      default:
        res.status(400).json({ error: 'Unknown email type' });
        return;
    }
  } catch (err) {
    console.error('[test-email] send failed', err);
    res.status(502).json({ error: 'Send failed — check Resend logs' });
    return;
  }

  res.status(200).json({ message: `Test email sent to ${normalizedTo}` });
}
