// Prompt content for the Incident Briefing Engine's Bedrock call (see
// README.md's Alerts & Admin section). Kept as plain data/logic, no HTTP or
// SDK imports here, so it stays testable in isolation from api/analysis/run.ts.
import type { Incident, Provider } from '../../src/types/status.js';
import { BRIEF_URGENCIES, EXEC_STANCES, IMPACT_LIKELIHOODS } from '../../src/utils/structuredBrief.js';

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

export function buildSystemPrompt(): string {
  const referenceTableText = Object.values(RESILIENCY_REFERENCE_TABLE)
    .map((entry) => `${entry.category}:\n${entry.questions.map((q) => `  - ${q}`).join('\n')}`)
    .join('\n\n');

  return [
    'You are writing incident briefs for a cloud status dashboard used by cloud engineering staff and executive leadership.',
    'You will be given one incident from a public cloud provider status feed (title, status, severity, affected services, affected regions, and the provider\'s own latest update text).',
    '',
    'Produce two briefs from a single read of the incident, by filling in the fields of the emit_incident_brief tool:',
    '- "technical": for cloud engineering staff. What is known, concrete next actions, which service categories to check, and failover/resiliency questions relevant to the affected regions.',
    '- "executive": for leadership and non-technical stakeholders. Plain language, no jargon: the bottom line, what is happening, how serious it is, whether customer-facing impact is likely, and which decisions leadership may need to make under which conditions.',
    '',
    'Urgency levels (used for next actions, resiliency question groups, and executive decisions):',
    '- immediate: do this now, while the incident is active.',
    '- high: do this soon, once immediate checks are done or if impact is confirmed.',
    '- medium: worthwhile hardening or follow-up during the incident.',
    '- monitor: keep watching; no action until something changes.',
    'Assign urgency honestly relative to this incident. Not everything is immediate. A resolved incident should mostly be medium/monitor (post-incident review, verifying recovery).',
    '',
    'Executive bottomLine.stance: "act-now" only if leadership must make a decision immediately; "decide-if-confirmed" if a decision depends on engineering confirming impact; "awareness" if no decision is needed yet.',
    '',
    'Writing rules for every text field:',
    '- Plain sentences. The only formatting allowed is **bold** (sparingly, for key service or region names) and `backticks` (for hostnames, endpoints, or identifiers). No headings, lists, tables, links, or emoji inside a field; the dashboard supplies all layout.',
    '- Do not restate the incident header (provider, severity, region, start time) or add a disclaimer. The dashboard already shows both.',
    '- One idea per list item. Keep each next action or decision to one or two sentences.',
    '- Technical brief: 3-6 next actions, 2-4 services to check, 2-4 resiliency question groups with 1-3 questions each.',
    '- Executive brief: whatsHappening, seriousness, and customerImpact.detail are each 2-4 sentences; 1-4 decisions, each a conditional scenario ("If customer-facing services are affected") with a recommendation.',
    '',
    'Hard rule on disaster-recovery/failover language: you have no visibility into whether the reader\'s workloads actually have cross-region or multi-AZ failover configured. Never write an unconditional instruction to fail over. Always phrase it conditionally, e.g. "if a cross-region or multi-AZ failover path exists for the affected service, this is when to consider using it" — never "fail over to your DR region now."',
    '',
    'Hard rule on grounding: do not invent specific technical claims beyond what the incident text supports. For resiliency/failover guidance in the technical brief, select and adapt from this fixed reference table rather than generating new claims:',
    '',
    referenceTableText,
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

const URGENCY_SCHEMA = { type: 'string', enum: [...BRIEF_URGENCIES] };
const TEXT = (description: string) => ({ type: 'string', description });

// Mirrors StructuredBriefs in src/utils/structuredBrief.ts, which also
// validates the returned input (parseStructuredBriefs) before it's stored.
const BRIEF_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    technical: {
      type: 'object',
      description: 'Technical brief for cloud engineering staff.',
      properties: {
        whatWeKnow: TEXT('2-4 sentences: what the provider has confirmed, and what is still unknown (root cause, ETA).'),
        nextActions: {
          type: 'array',
          description: '3-6 concrete next actions.',
          items: {
            type: 'object',
            properties: { urgency: URGENCY_SCHEMA, action: TEXT('One or two sentences.') },
            required: ['urgency', 'action'],
          },
        },
        servicesToCheck: {
          type: 'array',
          description: '2-4 service categories to check.',
          items: {
            type: 'object',
            properties: {
              name: TEXT('Short category name, e.g. "AI/ML inference".'),
              detail: TEXT('One or two sentences on what may be affected.'),
            },
            required: ['name', 'detail'],
          },
        },
        resiliencyQuestions: {
          type: 'array',
          description: '2-4 groups adapted from the reference table.',
          items: {
            type: 'object',
            properties: {
              category: TEXT('Category name, e.g. "Network and endpoints".'),
              urgency: URGENCY_SCHEMA,
              questions: { type: 'array', items: { type: 'string' }, description: '1-3 questions.' },
            },
            required: ['category', 'urgency', 'questions'],
          },
        },
      },
      required: ['whatWeKnow', 'nextActions', 'servicesToCheck', 'resiliencyQuestions'],
    },
    executive: {
      type: 'object',
      description: 'Executive brief for leadership. Plain language, no jargon.',
      properties: {
        bottomLine: {
          type: 'object',
          properties: {
            stance: { type: 'string', enum: [...EXEC_STANCES] },
            text: TEXT('1-2 sentences: the one thing leadership should take away.'),
          },
          required: ['stance', 'text'],
        },
        whatsHappening: TEXT('2-4 sentences, explaining what the affected services are in plain terms.'),
        seriousness: TEXT('2-4 sentences: partial vs total outage, whether a cause or ETA is known.'),
        customerImpact: {
          type: 'object',
          properties: {
            likelihood: { type: 'string', enum: [...IMPACT_LIKELIHOODS] },
            detail: TEXT('2-4 sentences: which kinds of customer-facing features would be affected, and under what conditions.'),
          },
          required: ['likelihood', 'detail'],
        },
        decisions: {
          type: 'array',
          description: '1-4 conditional decisions.',
          items: {
            type: 'object',
            properties: {
              scenario: TEXT('The condition, e.g. "If customer-facing services are affected".'),
              recommendation: TEXT('One or two sentences.'),
              urgency: URGENCY_SCHEMA,
            },
            required: ['scenario', 'recommendation', 'urgency'],
          },
        },
      },
      required: ['bottomLine', 'whatsHappening', 'seriousness', 'customerImpact', 'decisions'],
    },
  },
  required: ['technical', 'executive'],
};

export function buildToolConfig() {
  return {
    tools: [
      {
        toolSpec: {
          name: EMIT_INCIDENT_BRIEF_TOOL_NAME,
          description: 'Emit the technical and executive incident briefs as structured fields.',
          inputSchema: { json: BRIEF_INPUT_SCHEMA },
        },
      },
    ],
    toolChoice: { tool: { name: EMIT_INCIDENT_BRIEF_TOOL_NAME } },
  };
}

export { EMIT_INCIDENT_BRIEF_TOOL_NAME };
