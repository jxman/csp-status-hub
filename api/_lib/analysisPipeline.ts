// Core Incident Briefing Engine pipeline (see README.md's Alerts & Admin
// section) — debounce check, Bedrock call, Postgres write, best-effort PDF
// generation. Shared by api/analysis/run.ts (the CRON_SECRET-gated,
// fire-and-forget path from check-status.ts) and the admin retry action
// (api/admin/analysis-runs/[id].ts), so the two never duplicate this logic.
import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { sql } from './db.js';
import { bedrock, BEDROCK_MODEL_ID } from './bedrock.js';
import { buildSystemPrompt, buildUserMessage, buildToolConfig, EMIT_INCIDENT_BRIEF_TOOL_NAME } from './analysisPrompt.js';
import { renderAndUploadBriefPdfs } from './pdf/render.js';
import { getDebounceMinutes } from './analysisSettings.js';
import { parseStructuredBriefs, technicalToText, executiveToText, type StructuredBriefs } from '../../src/utils/structuredBrief.js';
import type { Incident, Provider } from '../../src/types/status.js';

export interface RunIncidentAnalysisInput {
  provider: Provider;
  incidentId: string;
  triggerEvent: 'new' | 'content_changed' | 'resolved';
  incident: Incident;
  // Skips the debounce check entirely — for an admin-triggered retry, a
  // distinct concept from a persistent debounceMinutes:0 setting (which
  // means "never debounce, ever" and should still pay for the lookup).
  bypassDebounce?: boolean;
}

export type RunIncidentAnalysisResult =
  | { skipped: true; reason: 'debounced'; minutesSinceLastRun: number; debounceMinutes: number }
  | { status: 'failed'; reason: 'no_tool_use' | 'invalid_structure' | 'exception' }
  | { status: 'complete'; rowId: string };

interface ToolUseContent {
  toolUse?: { name: string; input: unknown };
}

function extractToolInput(content: ToolUseContent[] | undefined): unknown {
  return content?.find((block) => block.toolUse?.name === EMIT_INCIDENT_BRIEF_TOOL_NAME)?.toolUse?.input;
}

// Bedrock calls per run. A malformed tool call is usually a one-off (the same
// input succeeds on the next call), so one retry recovers it at the cost of a
// second call only when the first fails.
const MAX_ATTEMPTS = 2;

// Short description of what the model sent, saved in a failed row's error so
// a failure can be diagnosed from the admin page without re-running it.
function describeToolInput(input: unknown): string {
  const kind = (v: unknown) => (v === undefined ? 'missing' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return `input=${kind(input)}`;
  const o = input as Record<string, unknown>;
  return `technical=${kind(o.technical)}, executive=${kind(o.executive)}`;
}

export async function runIncidentAnalysis(input: RunIncidentAnalysisInput): Promise<RunIncidentAnalysisResult> {
  const { provider, incidentId, triggerEvent, incident, bypassDebounce = false } = input;

  if (!bypassDebounce) {
    const debounceMinutes = await getDebounceMinutes();
    const [lastRun] = await sql`
      SELECT created_at FROM incident_analysis
      WHERE provider = ${provider} AND incident_id = ${incidentId}
      ORDER BY created_at DESC LIMIT 1
    `;
    if (lastRun && debounceMinutes > 0) {
      const minutesSinceLastRun = (Date.now() - new Date(lastRun.created_at as string | Date).getTime()) / 60_000;
      if (minutesSinceLastRun < debounceMinutes) {
        return { skipped: true, reason: 'debounced', minutesSinceLastRun, debounceMinutes };
      }
    }
  }

  try {
    const incidentSnapshot = JSON.stringify(incident);
    // Token counts are summed across attempts so a retried run records what
    // it actually cost, failed or not.
    let inputTokens = 0;
    let outputTokens = 0;
    let structured: StructuredBriefs | null = null;
    const attemptErrors: string[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !structured; attempt++) {
      const response = await bedrock.send(
        new ConverseCommand({
          modelId: BEDROCK_MODEL_ID,
          system: [{ text: buildSystemPrompt() }],
          messages: [{ role: 'user', content: [{ text: buildUserMessage(provider, incident) }] }],
          toolConfig: buildToolConfig(),
        })
      );
      inputTokens += response.usage?.inputTokens ?? 0;
      outputTokens += response.usage?.outputTokens ?? 0;

      const toolInput = extractToolInput(response.output?.message?.content as ToolUseContent[] | undefined);
      structured = toolInput === undefined ? null : parseStructuredBriefs(toolInput);
      if (!structured) {
        const what = toolInput === undefined ? 'no emit_incident_brief tool call' : `invalid structure (${describeToolInput(toolInput)})`;
        attemptErrors.push(`attempt ${attempt}: ${what}, stopReason=${response.stopReason ?? 'unknown'}`);
        console.warn(`[analysisPipeline] ${provider}/${incidentId} attempt ${attempt}/${MAX_ATTEMPTS}: ${what}, stopReason=${response.stopReason}`);
      }
    }

    if (!structured) {
      const reason = attemptErrors.every((e) => e.includes('no emit_incident_brief')) ? 'no_tool_use' : 'invalid_structure';
      const summary =
        reason === 'no_tool_use'
          ? 'Model did not return the expected emit_incident_brief tool call'
          : 'Model returned an emit_incident_brief call missing required structured fields';
      const error = `${summary} [${attemptErrors.join('; ')}]`;
      await sql`
        INSERT INTO incident_analysis
          (provider, incident_id, trigger_event, incident_snapshot, model, input_tokens, output_tokens, status, error)
        VALUES
          (${provider}, ${incidentId}, ${triggerEvent}, ${incidentSnapshot}::jsonb, ${BEDROCK_MODEL_ID}, ${inputTokens}, ${outputTokens}, 'failed', ${error})
      `;
      return { status: 'failed', reason };
    }

    // The text columns keep a plain-markdown rendering of the structured
    // brief for anything still reading them (admin run history, a tab on a
    // pre-structured bundle); briefs_structured is what the dashboard and
    // PDF render from.
    const briefs = { technical: technicalToText(structured.technical), executive: executiveToText(structured.executive) };

    const [{ id: rowId }] = await sql`
      INSERT INTO incident_analysis
        (provider, incident_id, trigger_event, incident_snapshot, technical_brief, executive_brief, briefs_structured, model, input_tokens, output_tokens, status)
      VALUES
        (${provider}, ${incidentId}, ${triggerEvent}, ${incidentSnapshot}::jsonb, ${briefs.technical}, ${briefs.executive}, ${JSON.stringify(structured)}::jsonb, ${BEDROCK_MODEL_ID}, ${inputTokens}, ${outputTokens}, 'complete')
      RETURNING id
    `;

    // PDF generation is best-effort, after the text brief has already
    // published — a failure here must never affect the result the text
    // brief already earned (see README.md's Alerts & Admin section).
    try {
      const { technicalUrl, executiveUrl } = await renderAndUploadBriefPdfs({
        provider,
        incidentId,
        rowId: rowId as string,
        incident,
        triggerEvent,
        createdAt: new Date().toISOString(),
        technicalBrief: briefs.technical,
        executiveBrief: briefs.executive,
        structured,
      });
      if (technicalUrl || executiveUrl) {
        await sql`
          UPDATE incident_analysis
          SET pdf_technical_url = COALESCE(${technicalUrl}, pdf_technical_url),
              pdf_executive_url = COALESCE(${executiveUrl}, pdf_executive_url)
          WHERE id = ${rowId}
        `;
      }
    } catch (pdfErr) {
      console.error(`[analysisPipeline] PDF generation failed for ${provider}/${incidentId} (row ${rowId}), text brief already published`, pdfErr);
    }

    return { status: 'complete', rowId: rowId as string };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analysisPipeline] Bedrock call failed for ${provider}/${incidentId}`, err);
    await sql`
      INSERT INTO incident_analysis
        (provider, incident_id, trigger_event, incident_snapshot, model, status, error)
      VALUES
        (${provider}, ${incidentId}, ${triggerEvent}, ${JSON.stringify(incident)}::jsonb, ${BEDROCK_MODEL_ID}, 'failed', ${message})
    `;
    return { status: 'failed', reason: 'exception' };
  }
}
