import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { sql } from '../_lib/db.js';
import { redis, snapshotKey, type ProviderSnapshot } from '../_lib/redis.js';
import { sendOutageNotificationEmail, sendResolutionNotificationEmail } from '../_lib/email.js';
import { getDisabledProviders } from '../_lib/analysisSettings.js';
import { matchRenamedIncidents, type IncidentRename } from '../_lib/incidentRenames.js';
import { fetchAws } from '../../src/fetchers/awsFetcher.js';
import { fetchGcp } from '../../src/fetchers/gcpFetcher.js';
import { fetchOci } from '../../src/fetchers/ociFetcher.js';
import { fetchAzure } from '../_lib/azureFetcher.js';
import type { Incident, Provider, ProviderStatus } from '../../src/types/status.js';

const FETCHERS: Record<string, () => Promise<ProviderStatus>> = {
  aws: fetchAws,
  azure: fetchAzure,
  gcp: fetchGcp,
  oci: fetchOci,
};

// Content hash for a single incident (Incident Briefing Engine trigger —
// see README.md's Alerts & Admin section). Distinct from the notify-worthy
// diff above: an incident whose ID hasn't changed can still get a real
// vendor update to its status/description, which this hash is meant to
// catch. affectedServices/affectedRegions are sorted since these fetchers
// don't guarantee stable array ordering between polls.
function hashIncidentContent(incident: Incident): string {
  const services = [...incident.affectedServices].sort().join(',');
  const regions = [...incident.affectedRegions].sort().join(',');
  return createHash('sha256').update(`${incident.status}|${incident.latestUpdate}|${services}|${regions}`).digest('hex');
}

type AnalysisTriggerEvent = 'new' | 'content_changed' | 'resolved';

// Fire-and-forget POST to the Bedrock analysis endpoint. Never awaited by
// the caller — waitUntil() schedules this after the response is already
// sent, so a slow or failed Bedrock call can never delay check-status.ts's
// own response or the outage-notification email path above it.
function triggerAnalysis(provider: Provider, incidentId: string, triggerEvent: AnalysisTriggerEvent, incident: Incident): void {
  const base = process.env.APP_BASE_URL;
  if (!base) return;
  waitUntil(
    fetch(`${base}/api/analysis/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {}),
      },
      body: JSON.stringify({ provider, incidentId, triggerEvent, incident }),
    }).catch((err) => {
      console.error(`[check-status] analysis trigger failed for ${provider}/${incidentId}`, err);
    })
  );
}

type NotificationEvent = 'new_incident' | 'incident_resolved';

interface IncidentSummary {
  id: string;
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
        provider as Provider,
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
    renamedIncidents?: IncidentRename[];
    error?: string;
    notified?: number;
    resolvedNotified?: number;
  }> = {};

  // Read once per tick, not once per incident — this is purely a
  // Bedrock-cost/analysis control and must never affect notifySubscribers()
  // below (see README.md's Alerts & Admin section).
  const disabledProviders = await getDisabledProviders();

  for (const [provider, fetcher] of Object.entries(FETCHERS)) {
    try {
      const status = await fetcher();
      const activeIncidents = status.activeIncidents.filter((i) => i.status !== 'resolved');
      const activeIds = activeIncidents.map((i) => i.id).sort();

      const existing = await redis.get<ProviderSnapshot>(snapshotKey(provider));
      const previousStatus: string | null = existing?.overallStatus ?? null;
      const previousIds: string[] = existing?.activeIncidentIds ?? [];
      const previousTitles: Record<string, string> = existing?.activeIncidentTitles ?? {};
      const previousRegions: Record<string, string[]> = existing?.activeIncidentRegions ?? {};
      const previousContentHashes: Record<string, string> = existing?.activeIncidentContentHashes ?? {};
      const previousIncidentSnapshots: Record<string, Incident> = existing?.activeIncidentSnapshots ?? {};

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
      const activeIncidentSnapshots: Record<string, Incident> = Object.fromEntries(
        activeIncidents.map((i) => [i.id, i])
      );
      const appearedIds = activeIds.filter((id) => !previousIds.includes(id));
      const vanishedIds = previousIds.filter((id) => !activeIds.includes(id));
      // A vanished id and a new id with the same startTime are one incident
      // whose derived id changed because the provider edited it (see
      // incidentRenames.ts) — not a resolution plus a new incident. Pull
      // those out so neither email fires; the new id is re-analyzed as a
      // content change instead.
      const renames = isFirstCheck
        ? []
        : matchRenamedIncidents(vanishedIds, appearedIds, previousIncidentSnapshots, activeIncidentSnapshots);
      const renamedFromIds = new Set(renames.map((r) => r.fromId));
      const renamedToIds = new Set(renames.map((r) => r.toId));
      const newIncidentIds = appearedIds.filter((id) => !renamedToIds.has(id));
      const resolvedIncidentIds = vanishedIds.filter((id) => !renamedFromIds.has(id));
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
        id,
        title: activeIncidentTitles[id] ?? id,
        regions: activeIncidentRegions[id] ?? [],
      }));
      const resolvedIncidents = resolvedIncidentIds.map((id) => ({
        id,
        title: previousTitles[id] ?? id,
        regions: previousRegions[id] ?? [],
      }));

      // Incident Briefing Engine trigger classification (see README.md's
      // Alerts & Admin section) — layered additively on top of the
      // notify-worthy diff above, which stays exactly as it was.
      const activeIncidentContentHashes: Record<string, string> = Object.fromEntries(
        activeIncidents.map((i) => [i.id, hashIncidentContent(i)])
      );
      const contentChangedIncidentIds = isFirstCheck
        ? []
        : [
            ...activeIds.filter(
              (id) => previousIds.includes(id) && previousContentHashes[id] !== activeIncidentContentHashes[id]
            ),
            ...renamedToIds,
          ];

      await redis.set<ProviderSnapshot>(snapshotKey(provider), {
        overallStatus: status.overallStatus,
        activeIncidentIds: activeIds,
        activeIncidentTitles,
        activeIncidentRegions,
        activeIncidentContentHashes,
        activeIncidentSnapshots,
        lastCheckedAt: new Date().toISOString(),
      });

      results[provider] = { notifyWorthy, from: previousStatus, to: status.overallStatus, newIncidentIds, resolvedIncidentIds };
      if (renames.length > 0) {
        results[provider].renamedIncidents = renames;
        for (const { fromId, toId } of renames) {
          console.log(
            `[check-status] rename: ${provider} incident ${fromId} -> ${toId} (same startTime ${activeIncidentSnapshots[toId]?.startTime}; ` +
              `title "${previousTitles[fromId] ?? ''}" -> "${activeIncidentTitles[toId] ?? ''}") — no new/resolved emails sent`
          );
        }
      }
      if (notifyWorthy) {
        console.log(`[check-status] notify-worthy change: ${provider} new incident(s) ${newIncidentIds.join(', ')} (status ${previousStatus} -> ${status.overallStatus})`);
        results[provider].notified = await notifySubscribers(provider, status, 'new_incident', newIncidents);
      }
      if (resolutionWorthy) {
        console.log(`[check-status] resolution: ${provider} incident(s) resolved ${resolvedIncidentIds.join(', ')} (status ${previousStatus} -> ${status.overallStatus})`);
        results[provider].resolvedNotified = await notifySubscribers(provider, status, 'incident_resolved', resolvedIncidents);
      }

      // Fire-and-forget analysis triggers — deliberately placed after both
      // notifySubscribers() awaits above and never awaited themselves, so a
      // slow or failed Bedrock call can never delay this provider's
      // notifications or the next provider's iteration of this loop.
      if (!isFirstCheck) {
        if (disabledProviders.has(provider as Provider)) {
          const skipped = [...newIncidentIds, ...contentChangedIncidentIds, ...resolvedIncidentIds];
          if (skipped.length > 0) {
            console.log(`[check-status] analysis disabled for ${provider} - skipping trigger for ${skipped.join(', ')}`);
          }
        } else {
          for (const id of newIncidentIds) {
            const incident = activeIncidentSnapshots[id];
            if (incident) triggerAnalysis(provider as Provider, id, 'new', incident);
          }
          for (const id of contentChangedIncidentIds) {
            const incident = activeIncidentSnapshots[id];
            if (incident) triggerAnalysis(provider as Provider, id, 'content_changed', incident);
          }
          for (const id of resolvedIncidentIds) {
            const incident = previousIncidentSnapshots[id];
            if (incident) triggerAnalysis(provider as Provider, id, 'resolved', { ...incident, status: 'resolved' });
          }
        }
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
