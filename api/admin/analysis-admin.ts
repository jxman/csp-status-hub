// Incident Briefing Engine admin surface (see README.md's Alerts & Admin
// section, Phase 4): run history, manual retry, and live settings
// (debounce interval, per-provider kill switch), combined into one
// endpoint — this Vercel project is on the Hobby plan, capped at 12
// Serverless Functions per deployment, so run-history/retry/settings share
// one function instead of three (all admin_-gated, all part of the same
// "Incident Briefing Engine admin" concern, so the merge doesn't blur
// unrelated responsibilities together).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../_lib/auth.js';
import { sql } from '../_lib/db.js';
import { redis } from '../_lib/redis.js';
import { runIncidentAnalysis } from '../_lib/analysisPipeline.js';
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    if (req.query.resource === 'runs') {
      const runs = await sql`
        SELECT id, provider, incident_id, incident_snapshot->>'title' AS incident_title,
               trigger_event, status, error, model, created_at, pdf_technical_url, pdf_executive_url
        FROM incident_analysis
        ORDER BY created_at DESC
        LIMIT 200
      `;
      res.status(200).json({ runs });
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
      if (rows[0].status !== 'failed') {
        res.status(400).json({ error: 'Only failed rows can be retried' });
        return;
      }
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
