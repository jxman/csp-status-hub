import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { sql } from '../_lib/db.js';
import { redis, snapshotKey, type ProviderSnapshot } from '../_lib/redis.js';
import { sendOutageNotificationEmail, sendResolutionNotificationEmail } from '../_lib/email.js';
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

type NotificationEvent = 'new_incident' | 'incident_resolved';

interface IncidentSummary {
  title: string;
  regions: string[];
}

async function notifySubscribers(
  provider: string,
  status: ProviderStatus,
  eventType: NotificationEvent,
  incidents: IncidentSummary[]
): Promise<number> {
  const subscribers = await sql`
    SELECT id, name, email, manage_token FROM subscribers
    WHERE status = 'confirmed'
      AND (${provider} = ANY(providers) OR 'all' = ANY(providers))
  `;

  const base = process.env.APP_BASE_URL ?? '';
  const sendEmail = eventType === 'new_incident' ? sendOutageNotificationEmail : sendResolutionNotificationEmail;

  await Promise.all(
    subscribers.map(async (sub) => {
      const manageUrl = `${base}/manage?token=${sub.manage_token}`;
      const unsubscribeUrl = `${base}/manage?token=${sub.manage_token}&action=unsubscribe`;

      const success = await sendEmail(
        sub.email,
        sub.name,
        status.displayName,
        status.overallStatus,
        incidents,
        base || status.sourceUrl,
        manageUrl,
        unsubscribeUrl
      ).catch((err) => {
        console.error(`[check-status] notification send threw for ${sub.email}`, err);
        return false;
      });

      await sql`
        INSERT INTO notification_log (subscriber_id, provider, channel, event_type, success)
        VALUES (${sub.id}, ${provider}, 'email', ${eventType}, ${success})
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

  const results: Record<string, {
    notifyWorthy: boolean;
    from: string | null;
    to?: string;
    newIncidentIds?: string[];
    resolvedIncidentIds?: string[];
    error?: string;
    notified?: number;
    resolvedNotified?: number;
  }> = {};

  for (const [provider, fetcher] of Object.entries(FETCHERS)) {
    try {
      const status = await fetcher();
      const activeIds = status.activeIncidents
        .filter((i) => i.status !== 'resolved')
        .map((i) => i.id)
        .sort();
      const signature = computeSignature(status, activeIds);

      const existing = await redis.get<ProviderSnapshot>(snapshotKey(provider));
      const previousStatus: string | null = existing?.overallStatus ?? null;
      const previousIds: string[] = existing?.activeIncidentIds ?? [];
      const previousTitles: Record<string, string> = existing?.activeIncidentTitles ?? {};
      const previousRegions: Record<string, string[]> = existing?.activeIncidentRegions ?? {};

      // Alert on any incident ID we haven't seen before, not just a transition off a
      // clean 'operational' baseline — a provider can have a long-running unrelated
      // incident (e.g. a still-open regional outage) that keeps overallStatus stuck
      // at non-operational, which would otherwise mask every subsequent new incident.
      // Conversely, an ID that was active last check but is missing from this fetch is
      // treated as resolved — this covers both providers that publish an explicit
      // resolved/closed update (AWS, GCP) and providers that just drop the entry from
      // the feed once it clears (Azure, sometimes; OCI's synthesized single-incident-id).
      // Skip both on the very first-ever check for a provider (no row yet) so we don't
      // fire a notification storm for whatever is already in progress at bootstrap.
      const isFirstCheck = existing === null;
      const newIncidentIds = activeIds.filter((id) => !previousIds.includes(id));
      const resolvedIncidentIds = previousIds.filter((id) => !activeIds.includes(id));
      const notifyWorthy = !isFirstCheck && newIncidentIds.length > 0;
      const resolutionWorthy = !isFirstCheck && resolvedIncidentIds.length > 0;

      // Titles/regions for new incidents come straight from this fetch. Titles/regions
      // for resolved incidents have to come from the *previous* snapshot — by the time
      // an incident disappears from the feed (Azure/OCI-style), there's nothing left to
      // read them from in the current fetch.
      const activeIncidentTitles: Record<string, string> = Object.fromEntries(
        status.activeIncidents.filter((i) => activeIds.includes(i.id)).map((i) => [i.id, i.title])
      );
      const activeIncidentRegions: Record<string, string[]> = Object.fromEntries(
        status.activeIncidents.filter((i) => activeIds.includes(i.id)).map((i) => [i.id, i.affectedRegions])
      );
      const newIncidents = newIncidentIds.map((id) => ({
        title: activeIncidentTitles[id] ?? id,
        regions: activeIncidentRegions[id] ?? [],
      }));
      const resolvedIncidents = resolvedIncidentIds.map((id) => ({
        title: previousTitles[id] ?? id,
        regions: previousRegions[id] ?? [],
      }));

      await redis.set<ProviderSnapshot>(snapshotKey(provider), {
        overallStatus: status.overallStatus,
        activeIncidentIds: activeIds,
        activeIncidentTitles,
        activeIncidentRegions,
        lastCheckedAt: new Date().toISOString(),
        rawSignature: signature,
      });

      results[provider] = { notifyWorthy, from: previousStatus, to: status.overallStatus, newIncidentIds, resolvedIncidentIds };
      if (notifyWorthy) {
        console.log(`[check-status] notify-worthy change: ${provider} new incident(s) ${newIncidentIds.join(', ')} (status ${previousStatus} -> ${status.overallStatus})`);
        results[provider].notified = await notifySubscribers(provider, status, 'new_incident', newIncidents);
      }
      if (resolutionWorthy) {
        console.log(`[check-status] resolution: ${provider} incident(s) resolved ${resolvedIncidentIds.join(', ')} (status ${previousStatus} -> ${status.overallStatus})`);
        results[provider].resolvedNotified = await notifySubscribers(provider, status, 'incident_resolved', resolvedIncidents);
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
