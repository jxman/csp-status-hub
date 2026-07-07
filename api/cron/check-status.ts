import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { sql } from '../_lib/db.js';
import { sendOutageNotificationEmail } from '../_lib/email.js';
import { fetchAws } from '../../src/fetchers/awsFetcher.js';
import { fetchGcp } from '../../src/fetchers/gcpFetcher.js';
import { fetchOci } from '../../src/fetchers/ociFetcher.js';
import { fetchAzure } from '../_lib/azureFetcher.js';
import type { ProviderStatus } from '../../src/types/status.js';

const FETCHERS: Record<string, () => Promise<ProviderStatus>> = {
  aws: fetchAws,
  azure: fetchAzure,
  gcp: fetchGcp,
  oci: fetchOci,
};

function computeSignature(status: ProviderStatus, activeIds: string[]): string {
  return createHash('sha256').update(`${status.overallStatus}:${activeIds.join(',')}`).digest('hex');
}

async function notifySubscribers(provider: string, status: ProviderStatus): Promise<number> {
  const subscribers = await sql`
    SELECT id, name, email, manage_token FROM subscribers
    WHERE status = 'confirmed'
      AND (${provider} = ANY(providers) OR 'all' = ANY(providers))
  `;

  const base = process.env.APP_BASE_URL ?? '';

  await Promise.all(
    subscribers.map(async (sub) => {
      const manageUrl = `${base}/manage?token=${sub.manage_token}`;
      const unsubscribeUrl = `${base}/api/subscribe/unsubscribe?token=${sub.manage_token}`;

      const success = await sendOutageNotificationEmail(
        sub.email,
        sub.name,
        status.displayName,
        status.overallStatus,
        base || status.sourceUrl,
        manageUrl,
        unsubscribeUrl
      ).catch((err) => {
        console.error(`[check-status] notification send threw for ${sub.email}`, err);
        return false;
      });

      await sql`
        INSERT INTO notification_log (subscriber_id, provider, channel, event_type, success)
        VALUES (${sub.id}, ${provider}, 'email', 'new_incident', ${success})
      `;
    })
  );

  return subscribers.length;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (process.env.CRON_SECRET) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const results: Record<string, { notifyWorthy: boolean; from: string | null; to?: string; error?: string; notified?: number }> = {};

  for (const [provider, fetcher] of Object.entries(FETCHERS)) {
    try {
      const status = await fetcher();
      const activeIds = status.activeIncidents
        .filter((i) => i.status !== 'resolved')
        .map((i) => i.id)
        .sort();
      const signature = computeSignature(status, activeIds);

      const existing = await sql`
        SELECT overall_status FROM provider_status_snapshot WHERE provider = ${provider}
      `;
      const previousStatus: string | null = existing[0]?.overall_status ?? null;

      // 14.7: v1 only cares about a fresh outage starting from a clean state —
      // not escalation, not incident updates, not resolution.
      const notifyWorthy = previousStatus === 'operational' && status.overallStatus !== 'operational';

      await sql`
        INSERT INTO provider_status_snapshot (provider, overall_status, active_incident_ids, last_checked_at, raw_signature)
        VALUES (${provider}, ${status.overallStatus}, ${activeIds}, now(), ${signature})
        ON CONFLICT (provider) DO UPDATE SET
          overall_status = EXCLUDED.overall_status,
          active_incident_ids = EXCLUDED.active_incident_ids,
          last_checked_at = EXCLUDED.last_checked_at,
          raw_signature = EXCLUDED.raw_signature
      `;

      results[provider] = { notifyWorthy, from: previousStatus, to: status.overallStatus };
      if (notifyWorthy) {
        console.log(`[check-status] notify-worthy change: ${provider} operational -> ${status.overallStatus}`);
        results[provider].notified = await notifySubscribers(provider, status);
      }
    } catch (err) {
      // Leave the last-known snapshot untouched on a transient fetch failure
      // rather than overwriting it with 'unknown' — avoids manufacturing a
      // false transition on the next successful check.
      const message = err instanceof Error ? err.message : String(err);
      results[provider] = { notifyWorthy: false, from: null, error: message };
      console.error(`[check-status] fetch failed for ${provider}`, err);
    }
  }

  res.status(200).json({ checkedAt: new Date().toISOString(), results });
}
