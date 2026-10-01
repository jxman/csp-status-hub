// Incident Briefing Engine admin surface (see README.md's Alerts & Admin
// section, Phase 4): run history, manual retry, and live settings
// (debounce interval, per-provider kill switch), combined into one
// endpoint — this Vercel project is on the Hobby plan, capped at 12
// Serverless Functions per deployment, so run-history/retry/settings share
// one function instead of three (all admin_-gated, all part of the same
// "Incident Briefing Engine admin" concern, so the merge doesn't blur
// unrelated responsibilities together).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { del } from '@vercel/blob';
import { requireAdmin } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { redis, snapshotKey, type ProviderSnapshot } from '../_lib/redis.js';
import { runIncidentAnalysis } from '../_lib/analysisPipeline.js';
import { HISTORY_RETENTION_DAYS } from '../_lib/incidentHistory.js';
import { FAILED_RETENTION_DAYS, SUPERSEDED_GRACE, deleteUnusedRuns, listClassifiedRuns } from '../_lib/runRetention.js';
import {
  ALL_PROVIDERS,
  DEBOUNCE_SETTING_KEY,
  DEFAULT_DEBOUNCE_MINUTES,
  getDebounceMinutes,
  getDisabledProviders,
  setDebounceOverride,
  clearDebounceOverride,
  setDisabledProviders,
} from '../_lib/analysisSettings.js';
import type { Incident, Provider } from '../../src/types/status.js';

// "Active" here means "currently on the live dashboard" — driven by the same
// per-provider Redis snapshot check-status.ts writes every 5 min (activeIncidentIds),
// not anything stored on the incident_analysis row itself. Fails closed
// (confirmed: false) rather than treating a missing or stale snapshot as
// "nothing is active" — a Redis hiccup must never make the bulk cleanup below
// think every row is eligible for deletion.
const SNAPSHOT_STALE_MS = 24 * 60 * 60 * 1000;

async function getActiveIncidentKeys(): Promise<{ keys: string[]; confirmed: boolean; reason?: string }> {
  const snapshots = await Promise.all(ALL_PROVIDERS.map((p) => redis.get<ProviderSnapshot>(snapshotKey(p))));
  const missing = ALL_PROVIDERS.filter((_, i) => !snapshots[i]);
  if (missing.length > 0) {
    return { keys: [], confirmed: false, reason: `No status snapshot yet for: ${missing.join(', ')}` };
  }
  const now = Date.now();
  const stale = ALL_PROVIDERS.filter((_, i) => now - new Date(snapshots[i]!.lastCheckedAt).getTime() > SNAPSHOT_STALE_MS);
  if (stale.length > 0) {
    return { keys: [], confirmed: false, reason: `Status snapshot is more than 24h old for: ${stale.join(', ')}` };
  }
  const keys = ALL_PROVIDERS.flatMap((p, i) => snapshots[i]!.activeIncidentIds.map((id) => `${p}:${id}`));
  return { keys, confirmed: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    if (req.query.resource === 'runs') {
      // Link classification needs the active set, so this can't run in
      // parallel with it. If active state is unconfirmed, runs are still
      // listed (badges show "—" and cleanup is refused below).
      const active = await getActiveIncidentKeys();
      const { runs, deletableCount } = await listClassifiedRuns(active.keys);
      res.status(200).json({
        runs,
        deletableCount: active.confirmed ? deletableCount : 0,
        retentionDays: HISTORY_RETENTION_DAYS,
        failedRetentionDays: FAILED_RETENTION_DAYS,
        supersededGrace: SUPERSEDED_GRACE,
        activeConfirmed: active.confirmed,
        activeReason: active.reason ?? null,
      });
      return;
    }

    const [override, effective, disabledProviders] = await Promise.all([
      redis.get<number>(DEBOUNCE_SETTING_KEY),
      getDebounceMinutes(),
      getDisabledProviders(),
    ]);
    res.status(200).json({
      debounce: {
        override: typeof override === 'number' ? override : null,
        envDefault: DEFAULT_DEBOUNCE_MINUTES,
        effective,
      },
      disabledProviders: [...disabledProviders],
    });
    return;
  }

  if (req.method === 'PATCH') {
    const { action } = (req.body ?? {}) as { action?: unknown };

    if (action === 'retry') {
      const { id } = req.body as { id?: unknown };
      if (typeof id !== 'string') {
        res.status(400).json({ error: 'Missing id' });
        return;
      }
      const rows = await sql`
        SELECT provider, incident_id, trigger_event, incident_snapshot, status
        FROM incident_analysis WHERE id = ${id}
      `;
      if (rows.length === 0) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      // Re-running a 'complete' row (not just a 'failed' one) is intentional —
      // e.g. to pick up a prompt change for an incident that's still active.
      // Always inserts a new row (bypassDebounce) rather than mutating this
      // one, same as a failed-row retry; the dashboard already only ever
      // shows the latest row per (provider, incidentId).
      const result = await runIncidentAnalysis({
        provider: rows[0].provider as Provider,
        incidentId: rows[0].incident_id as string,
        triggerEvent: rows[0].trigger_event as 'new' | 'content_changed' | 'resolved',
        incident: rows[0].incident_snapshot as Incident,
        bypassDebounce: true,
      });
      res.status(200).json(result);
      return;
    }

    if (action === 'delete_run') {
      const { id } = req.body as { id?: unknown };
      if (typeof id !== 'string') {
        res.status(400).json({ error: 'Missing id' });
        return;
      }
      const [row] = await sql`
        DELETE FROM incident_analysis WHERE id = ${id}
        RETURNING pdf_technical_url, pdf_executive_url
      `;
      if (!row) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const blobUrls = [row.pdf_technical_url, row.pdf_executive_url].filter((u): u is string => !!u);
      if (blobUrls.length > 0) {
        try {
          await del(blobUrls);
        } catch (err) {
          console.error(`[analysis-admin] blob delete failed for run ${id}`, err);
        }
      }
      res.status(200).json({ deletedRows: 1, deletedBlobs: blobUrls.length });
      return;
    }

    // Action name kept for compatibility with an already-open admin tab; it
    // now removes every run runRetention.ts marks as unused (superseded,
    // resolved failures, unlinked).
    if (action === 'cleanup_inactive') {
      const active = await getActiveIncidentKeys();
      if (!active.confirmed) {
        res.status(409).json({ error: `Can't confirm which incidents are currently active — ${active.reason}. Refusing to delete anything until the next status check.` });
        return;
      }
      const rows = await deleteUnusedRuns(active.keys);
      const blobUrls = rows.flatMap((r) => [r.pdf_technical_url, r.pdf_executive_url].filter((u): u is string => !!u));
      let deletedBlobs = 0;
      if (blobUrls.length > 0) {
        try {
          await del(blobUrls);
          deletedBlobs = blobUrls.length;
        } catch (err) {
          console.error('[analysis-admin] bulk blob delete failed', err);
        }
      }
      res.status(200).json({ deletedRows: rows.length, deletedBlobs });
      return;
    }

    if (action === 'set_debounce') {
      const { minutes } = req.body as { minutes?: unknown };
      if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
        res.status(400).json({ error: 'minutes must be a non-negative number' });
        return;
      }
      await setDebounceOverride(minutes);
      res.status(200).json({ message: 'Debounce override set' });
      return;
    }

    if (action === 'clear_debounce') {
      await clearDebounceOverride();
      res.status(200).json({ message: 'Debounce override cleared' });
      return;
    }

    if (action === 'set_disabled_providers') {
      const { providers } = req.body as { providers?: unknown };
      if (!Array.isArray(providers) || !providers.every((p) => ALL_PROVIDERS.includes(p as Provider))) {
        res.status(400).json({ error: 'providers must be an array of valid provider keys' });
        return;
      }
      await setDisabledProviders(providers as Provider[]);
      res.status(200).json({ message: 'Disabled providers updated' });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
