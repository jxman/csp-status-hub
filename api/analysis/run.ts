// Incident Briefing Engine, Phase 1 (see README.md's Alerts & Admin
// section). Called fire-and-forget from api/cron/check-status.ts via
// waitUntil() whenever an incident is new, has changed content, or has
// resolved — never awaited there, so a slow or failed Bedrock call can
// never delay or block the outage-notification email path.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { sql } from '../_lib/db.js';
import { redis } from '../_lib/redis.js';
import { bedrock, BEDROCK_MODEL_ID } from '../_lib/bedrock.js';
import { buildSystemPrompt, buildUserMessage, buildToolConfig, EMIT_INCIDENT_BRIEF_TOOL_NAME } from '../_lib/analysisPrompt.js';
import type { Incident, Provider } from '../../src/types/status.js';

const DEBOUNCE_SETTING_KEY = 'settings:analysis-debounce-minutes';
const DEFAULT_DEBOUNCE_MINUTES = 30;

interface RunRequestBody {
  provider: Provider;
  incidentId: string;
  triggerEvent: 'new' | 'content_changed' | 'resolved';
  incident: Incident;
}

async function getDebounceMinutes(): Promise<number> {
  try {
    const override = await redis.get<number>(DEBOUNCE_SETTING_KEY);
    if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
      return override;
    }
  } catch (err) {
    console.error('[analysis/run] failed to read live debounce override, falling back to env default', err);
  }
  const envValue = Number(process.env.ANALYSIS_DEBOUNCE_MINUTES);
  return Number.isFinite(envValue) && envValue >= 0 ? envValue : DEFAULT_DEBOUNCE_MINUTES;
}

interface ToolUseContent {
  toolUse?: { name: string; input: unknown };
}

function extractBriefs(content: ToolUseContent[] | undefined): { technical: string; executive: string } | null {
  const toolUse = content?.find((block) => block.toolUse?.name === EMIT_INCIDENT_BRIEF_TOOL_NAME)?.toolUse;
  if (!toolUse || typeof toolUse.input !== 'object' || toolUse.input === null) return null;
  const input = toolUse.input as Record<string, unknown>;
  if (typeof input.technical !== 'string' || typeof input.executive !== 'string') return null;
  return { technical: input.technical, executive: input.executive };
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

  const debounceMinutes = await getDebounceMinutes();
  const [lastRun] = await sql`
    SELECT created_at FROM incident_analysis
    WHERE provider = ${provider} AND incident_id = ${incidentId}
    ORDER BY created_at DESC LIMIT 1
  `;
  if (lastRun && debounceMinutes > 0) {
    const minutesSinceLastRun = (Date.now() - new Date(lastRun.created_at as string | Date).getTime()) / 60_000;
    if (minutesSinceLastRun < debounceMinutes) {
      res.status(200).json({ skipped: true, reason: 'debounced', minutesSinceLastRun, debounceMinutes });
      return;
    }
  }

  try {
    const response = await bedrock.send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        system: [{ text: buildSystemPrompt() }],
        messages: [{ role: 'user', content: [{ text: buildUserMessage(provider, incident) }] }],
        toolConfig: buildToolConfig(),
      })
    );

    const incidentSnapshot = JSON.stringify(incident);
    const briefs = extractBriefs(response.output?.message?.content as ToolUseContent[] | undefined);
    if (!briefs) {
      await sql`
        INSERT INTO incident_analysis
          (provider, incident_id, trigger_event, incident_snapshot, model, status, error)
        VALUES
          (${provider}, ${incidentId}, ${triggerEvent}, ${incidentSnapshot}::jsonb, ${BEDROCK_MODEL_ID}, 'failed', ${'Model did not return the expected emit_incident_brief tool call'})
      `;
      res.status(200).json({ status: 'failed', reason: 'no_tool_use' });
      return;
    }

    await sql`
      INSERT INTO incident_analysis
        (provider, incident_id, trigger_event, incident_snapshot, technical_brief, executive_brief, model, input_tokens, output_tokens, status)
      VALUES
        (${provider}, ${incidentId}, ${triggerEvent}, ${incidentSnapshot}::jsonb, ${briefs.technical}, ${briefs.executive}, ${BEDROCK_MODEL_ID}, ${response.usage?.inputTokens ?? null}, ${response.usage?.outputTokens ?? null}, 'complete')
    `;
    res.status(200).json({ status: 'complete' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analysis/run] Bedrock call failed for ${provider}/${incidentId}`, err);
    await sql`
      INSERT INTO incident_analysis
        (provider, incident_id, trigger_event, incident_snapshot, model, status, error)
      VALUES
        (${provider}, ${incidentId}, ${triggerEvent}, ${JSON.stringify(incident)}::jsonb, ${BEDROCK_MODEL_ID}, 'failed', ${message})
    `;
    res.status(200).json({ status: 'failed', reason: 'exception' });
  }
}
