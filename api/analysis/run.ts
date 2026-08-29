// Incident Briefing Engine, Phase 1 (see README.md's Alerts & Admin
// section). Called fire-and-forget from api/cron/check-status.ts via
// waitUntil() whenever an incident is new, has changed content, or has
// resolved — never awaited there, so a slow or failed Bedrock call can
// never delay or block the outage-notification email path. The actual
// pipeline lives in api/_lib/analysisPipeline.ts, shared with the admin
// retry action (api/admin/analysis-runs/[id].ts) — this handler is just
// the CRON_SECRET-gated HTTP entrypoint.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { runIncidentAnalysis } from '../_lib/analysisPipeline.js';
import type { Incident, Provider } from '../../src/types/status.js';

interface RunRequestBody {
  provider: Provider;
  incidentId: string;
  triggerEvent: 'new' | 'content_changed' | 'resolved';
  incident: Incident;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (process.env.CRON_SECRET) {
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  const { provider, incidentId, triggerEvent, incident } = (req.body ?? {}) as Partial<RunRequestBody>;
  if (!provider || !incidentId || !triggerEvent || !incident) {
    res.status(400).json({ error: 'Missing provider, incidentId, triggerEvent, or incident' });
    return;
  }

  const result = await runIncidentAnalysis({ provider, incidentId, triggerEvent, incident });
  res.status(200).json(result);
}
