// Prompt content for the Incident Briefing Engine's Bedrock call (see
// README.md's Alerts & Admin section). Kept as plain data/logic, no HTTP or
// SDK imports here, so it stays testable in isolation from api/analysis/run.ts.
import type { Incident, Provider } from '../../src/types/status.js';

// Hand-curated, not model-generated: the design doc's mitigation against an
// LLM inventing plausible-sounding specifics from a thin vendor status
// paragraph. The model is instructed to select and adapt from this fixed
// list rather than generate net-new resiliency claims.
export const RESILIENCY_REFERENCE_TABLE: Record<string, { category: string; questions: string[] }> = {
  compute: {
    category: 'Compute',
    questions: [
      'Is this workload spread across multiple Availability Zones, or pinned to one?',
      'Is there a warm/cold standby (or auto-scaling group) in another region that can absorb traffic?',
      'Are any instance/VM identifiers, AMIs, or images hard-coded to the affected region?',
    ],
  },
  network: {
    category: 'Network',
    questions: [
      'Does DNS/traffic routing fail over automatically, or does it need a manual cutover?',
      'Are there hard-coded IPs, endpoints, or peering connections scoped to the affected region?',
    ],
  },
  storage: {
    category: 'Storage',
    questions: [
      'Is data replicated cross-region, and how recent is the latest replica?',
      'Are backups stored outside the affected region, and have they been tested for restore?',
    ],
  },
  database: {
    category: 'Database',
    questions: [
      'Is there a cross-region read replica or standby that can be promoted?',
      'What is the expected data loss (RPO) if failing over to the last known-good replica?',
    ],
  },
  identity: {
    category: 'Identity',
    questions: [
      'Are authentication/authorization services region-pinned (e.g. a regional IdP endpoint), or global?',
      'Would a regional identity outage block break-glass/emergency access to other regions?',
    ],
  },
};

export const DISCLAIMER_TEXT =
  "This brief is AI-generated guidance based on the provider's public status update only — it has no visibility into your account, architecture, or configuration, and your environment may differ and require other steps. Do not assume automatic failover is configured; evaluate and execute any failover action based on your own architecture.";

export function buildSystemPrompt(): string {
  const referenceTableText = Object.values(RESILIENCY_REFERENCE_TABLE)
    .map((entry) => `${entry.category}:\n${entry.questions.map((q) => `  - ${q}`).join('\n')}`)
    .join('\n\n');

  return [
    'You are writing incident briefs for a cloud status dashboard used by cloud engineering staff and executive leadership.',
    'You will be given one incident from a public cloud provider status feed (title, status, severity, affected services, affected regions, and the provider\'s own latest update text).',
    '',
    'Produce two briefs from a single read of the incident:',
    '- "technical": for cloud engineering staff. Cover which service categories to check, specific failover/resiliency questions relevant to the affected regions, and concrete next actions ranked by urgency.',
    '- "executive": for leadership and non-technical stakeholders. Plain language, no jargon: what is affected, how serious it is, whether customer-facing impact is likely, and what decision (if any) leadership needs to make.',
    '',
    'Hard rule on disaster-recovery/failover language: you have no visibility into whether the reader\'s workloads actually have cross-region or multi-AZ failover configured. Never write an unconditional instruction to fail over. Always phrase it conditionally, e.g. "if a cross-region or multi-AZ failover path exists for the affected service, this is when to consider using it" — never "fail over to your DR region now."',
    '',
    'Hard rule on grounding: do not invent specific technical claims beyond what the incident text supports. For resiliency/failover guidance in the technical brief, select and adapt from this fixed reference table rather than generating new claims:',
    '',
    referenceTableText,
    '',
    `Append this disclaimer verbatim as the final line of BOTH the "technical" and "executive" briefs: "${DISCLAIMER_TEXT}"`,
    '',
    'Call the emit_incident_brief tool exactly once with both briefs. Do not respond with plain text.',
  ].join('\n');
}

export function buildUserMessage(provider: Provider, incident: Incident): string {
  return JSON.stringify(
    {
      provider,
      title: incident.title,
      status: incident.status,
      severity: incident.severity,
      affectedServices: incident.affectedServices,
      affectedRegions: incident.affectedRegions,
      latestUpdate: incident.latestUpdate,
      startTime: incident.startTime,
      endTime: incident.endTime,
    },
    null,
    2
  );
}

const EMIT_INCIDENT_BRIEF_TOOL_NAME = 'emit_incident_brief';

export function buildToolConfig() {
  return {
    tools: [
      {
        toolSpec: {
          name: EMIT_INCIDENT_BRIEF_TOOL_NAME,
          description: 'Emit the technical and executive incident briefs.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                technical: { type: 'string', description: 'The technical brief for cloud engineering staff, ending with the disclaimer sentence.' },
                executive: { type: 'string', description: 'The executive brief for leadership, ending with the disclaimer sentence.' },
              },
              required: ['technical', 'executive'],
            },
          },
        },
      },
    ],
    toolChoice: { tool: { name: EMIT_INCIDENT_BRIEF_TOOL_NAME } },
  };
}

export { EMIT_INCIDENT_BRIEF_TOOL_NAME };
