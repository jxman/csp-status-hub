// Structured AI Insight briefs (see README.md's Alerts & Admin → Incident
// Briefing Engine section). The model fills these fields via the
// emit_incident_brief tool (api/_lib/analysisPrompt.ts) instead of writing
// free-form markdown, so the dashboard (IncidentBriefPanel.tsx) and the PDF
// export (api/_lib/pdf/BriefDocument.ts) lay out every brief identically and
// color-code by a fixed urgency scale rather than whatever labels the model
// happened to invent that run. Plain .ts (no JSX) so the api/ bundle can
// import it at runtime, same as aiBriefDisclaimer.ts.
//
// Text fields may carry **bold** and `code` spans only — both renderers
// handle those two, nothing else.

import { AI_BRIEF_DISCLAIMER_TEXT } from './aiBriefDisclaimer.js';

export const BRIEF_URGENCIES = ['immediate', 'high', 'medium', 'monitor'] as const;
export type BriefUrgency = (typeof BRIEF_URGENCIES)[number];

export const URGENCY_LABEL: Record<BriefUrgency, string> = {
  immediate: 'Immediate',
  high: 'High',
  medium: 'Medium',
  monitor: 'Monitor',
};

export const EXEC_STANCES = ['act-now', 'decide-if-confirmed', 'awareness'] as const;
export type ExecStance = (typeof EXEC_STANCES)[number];

export const STANCE_LABEL: Record<ExecStance, string> = {
  'act-now': 'Decision needed now',
  'decide-if-confirmed': 'Decide if impact confirmed',
  awareness: 'Awareness · no decision yet',
};

// Each stance/likelihood reuses one urgency color so there's a single palette.
export const STANCE_URGENCY: Record<ExecStance, BriefUrgency> = {
  'act-now': 'immediate',
  'decide-if-confirmed': 'medium',
  awareness: 'monitor',
};

export const IMPACT_LIKELIHOODS = ['yes', 'possible', 'unlikely'] as const;
export type ImpactLikelihood = (typeof IMPACT_LIKELIHOODS)[number];

export const LIKELIHOOD_LABEL: Record<ImpactLikelihood, string> = {
  yes: 'Likely',
  possible: 'Possible',
  unlikely: 'Unlikely',
};

export const LIKELIHOOD_URGENCY: Record<ImpactLikelihood, BriefUrgency> = {
  yes: 'immediate',
  possible: 'high',
  unlikely: 'monitor',
};

export interface TechnicalBriefData {
  whatWeKnow: string;
  nextActions: { urgency: BriefUrgency; action: string }[];
  servicesToCheck: { name: string; detail: string }[];
  resiliencyQuestions: { category: string; urgency: BriefUrgency; questions: string[] }[];
}

export interface ExecutiveBriefData {
  bottomLine: { stance: ExecStance; text: string };
  whatsHappening: string;
  seriousness: string;
  customerImpact: { likelihood: ImpactLikelihood; detail: string };
  decisions: { scenario: string; recommendation: string; urgency: BriefUrgency }[];
}

export interface StructuredBriefs {
  version: 1;
  technical: TechnicalBriefData;
  executive: ExecutiveBriefData;
}

const urgencyRank = (u: BriefUrgency) => BRIEF_URGENCIES.indexOf(u);

// ---------- validation (model output → StructuredBriefs) ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Returns null if any required field is missing/invalid. Individual list
// items that are malformed are dropped rather than failing the whole brief;
// list sections are sorted most-urgent first so ordering never depends on
// the model getting it right.
export function parseStructuredBriefs(input: unknown): StructuredBriefs | null {
  if (!isObj(input) || !isObj(input.technical) || !isObj(input.executive)) return null;
  const t = input.technical;
  const e = input.executive;

  const whatWeKnow = str(t.whatWeKnow);
  const nextActions = arr(t.nextActions)
    .map((a) => (isObj(a) ? { urgency: oneOf(a.urgency, BRIEF_URGENCIES), action: str(a.action) } : null))
    .filter((a): a is TechnicalBriefData['nextActions'][number] => !!a?.urgency && !!a.action)
    .sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency));
  const servicesToCheck = arr(t.servicesToCheck)
    .map((s) => (isObj(s) ? { name: str(s.name), detail: str(s.detail) } : null))
    .filter((s): s is TechnicalBriefData['servicesToCheck'][number] => !!s?.name && !!s.detail);
  const resiliencyQuestions = arr(t.resiliencyQuestions)
    .map((q) =>
      isObj(q)
        ? {
            category: str(q.category),
            urgency: oneOf(q.urgency, BRIEF_URGENCIES),
            questions: arr(q.questions).map(str).filter((x): x is string => !!x),
          }
        : null
    )
    .filter((q): q is TechnicalBriefData['resiliencyQuestions'][number] => !!q?.category && !!q.urgency && q.questions.length > 0)
    .sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency));

  const bottomLine = isObj(e.bottomLine)
    ? { stance: oneOf(e.bottomLine.stance, EXEC_STANCES), text: str(e.bottomLine.text) }
    : null;
  const customerImpact = isObj(e.customerImpact)
    ? { likelihood: oneOf(e.customerImpact.likelihood, IMPACT_LIKELIHOODS), detail: str(e.customerImpact.detail) }
    : null;
  const whatsHappening = str(e.whatsHappening);
  const seriousness = str(e.seriousness);
  const decisions = arr(e.decisions)
    .map((d) =>
      isObj(d)
        ? { scenario: str(d.scenario), recommendation: str(d.recommendation), urgency: oneOf(d.urgency, BRIEF_URGENCIES) }
        : null
    )
    .filter((d): d is ExecutiveBriefData['decisions'][number] => !!d?.scenario && !!d.recommendation && !!d.urgency)
    .sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency));

  if (!whatWeKnow || nextActions.length === 0) return null;
  if (!bottomLine?.stance || !bottomLine.text || !customerImpact?.likelihood || !customerImpact.detail) return null;
  if (!whatsHappening || !seriousness) return null;

  return {
    version: 1,
    technical: { whatWeKnow, nextActions, servicesToCheck, resiliencyQuestions },
    executive: {
      bottomLine: { stance: bottomLine.stance, text: bottomLine.text },
      whatsHappening,
      seriousness,
      customerImpact: { likelihood: customerImpact.likelihood, detail: customerImpact.detail },
      decisions,
    },
  };
}

// ---------- plain-text rendering ----------

// Written into the legacy technical_brief/executive_brief text columns so
// anything still reading those (admin run history, a browser tab running a
// pre-structured bundle) keeps working. Ends with the disclaimer, matching
// what the old free-text briefs always carried.
export function technicalToText(t: TechnicalBriefData): string {
  const parts = [
    `### What We Know\n\n${t.whatWeKnow}`,
    `### Next Actions\n\n${t.nextActions.map((a) => `- **[${URGENCY_LABEL[a.urgency]}]** ${a.action}`).join('\n')}`,
  ];
  if (t.servicesToCheck.length) {
    parts.push(`### Services to Check\n\n${t.servicesToCheck.map((s) => `- **${s.name}:** ${s.detail}`).join('\n')}`);
  }
  if (t.resiliencyQuestions.length) {
    parts.push(
      `### Resiliency Questions\n\n${t.resiliencyQuestions
        .map((q) => `**${q.category}** *(${URGENCY_LABEL[q.urgency]})*\n${q.questions.map((x) => `- ${x}`).join('\n')}`)
        .join('\n\n')}`
    );
  }
  parts.push(AI_BRIEF_DISCLAIMER_TEXT);
  return parts.join('\n\n');
}

export function executiveToText(e: ExecutiveBriefData): string {
  const parts = [
    `### Bottom Line — ${STANCE_LABEL[e.bottomLine.stance]}\n\n${e.bottomLine.text}`,
    `### What's Happening\n\n${e.whatsHappening}`,
    `### How Serious Is It\n\n${e.seriousness}`,
    `### Customer-Facing Impact — ${LIKELIHOOD_LABEL[e.customerImpact.likelihood]}\n\n${e.customerImpact.detail}`,
  ];
  if (e.decisions.length) {
    parts.push(
      `### Decisions to Consider\n\n${e.decisions
        .map((d) => `- **[${URGENCY_LABEL[d.urgency]}] ${d.scenario}:** ${d.recommendation}`)
        .join('\n')}`
    );
  }
  parts.push(AI_BRIEF_DISCLAIMER_TEXT);
  return parts.join('\n\n');
}
