# Incident Briefing Engine — Prompt Refinement Guide

**Purpose:** a working reference for iterating on the AI Insight prompt over
time — how the pipeline actually works today, how to change the prompt
safely, concrete directions worth trying, and a scoped plan for exposing
some of this through an admin UI instead of requiring a code change +
redeploy every time. This is a planning/reference doc, not an as-built
record — nothing in Section 5 (admin UI) is built yet.

For the high-level architecture diagram and how this fits into the rest of
the app, see `README.md`'s **Alerts & Admin → Incident Briefing Engine**
section. This doc goes one level deeper, specifically on the prompt/model
piece, for whoever (probably future-you) is refining it.

---

## 1. How it works today — full workflow

**Trigger.** `api/cron/check-status.ts` runs every 5 minutes (AWS
EventBridge). For each active incident, it computes a content hash
(`status + latestUpdate + affectedServices + affectedRegions`) and compares
it to the hash stored in Redis from the last tick. An incident is
classified as `new`, `content_changed` (hash changed but the ID was already
active — the vendor edited the incident text in place), or `resolved`. This
is a separate check from the notification diff that drives outage emails —
they run side by side, not one feeding the other.

For each new/content_changed/resolved incident, `check-status.ts` fires
`waitUntil(fetch('/api/analysis/run', ...))` — fire-and-forget, placed
*after* `notifySubscribers()` has already run, so a slow or failed Bedrock
call can never delay or block an outage email.

**Debounce.** `/api/analysis/run` → `api/_lib/analysisPipeline.ts`'s
`runIncidentAnalysis()` first checks `MAX(created_at)` for this
`(provider, incidentId)` against `settings:analysis-debounce-minutes` (a
live Redis override) or `ANALYSIS_DEBOUNCE_MINUTES` (env default, 30 min).
If a row exists within that window, the run is skipped — this exists so a
vendor incident that gets 10 small text edits in an hour doesn't burn 10
Bedrock calls. Admin-triggered retries pass `bypassDebounce: true` to skip
this check entirely, since a retry is a distinct concept from "debounce
window of 0" (which is itself a legitimate persistent setting meaning
"never debounce").

**Prompt construction.** All prompt logic lives in
`api/_lib/analysisPrompt.ts` — see Section 2 below for the actual content.
Three functions are called from `runIncidentAnalysis()`:

```ts
system: [{ text: buildSystemPrompt() }],
messages: [{ role: 'user', content: [{ text: buildUserMessage(provider, incident) }] }],
toolConfig: buildToolConfig(),
```

**The Bedrock call.** `api/_lib/bedrock.ts` builds a
`BedrockRuntimeClient` authenticated via Vercel's native OIDC → AWS
federation (`sts:AssumeRoleWithWebIdentity`, no static AWS keys — see
`scripts/setup-bedrock-oidc.sh`). `runIncidentAnalysis()` sends a single
`ConverseCommand` with `modelId: BEDROCK_MODEL_ID`. This is a **cross-region
inference profile ID**, not a bare on-demand model ID — Claude models on
Bedrock only support `INFERENCE_PROFILE` invocation. Currently
`us.anthropic.claude-sonnet-4-5-20250929-v1:0` via the `BEDROCK_MODEL_ID`
env var; the code default (`bedrock.ts`) is `us.anthropic.claude-sonnet-5`,
which returns `AccessDeniedException` on this AWS account pending an
AWS-Sales-approved allowlist request — that's why the env var override
exists and must stay set.

**Forced tool use.** `toolConfig.toolChoice` pins the model to call
`emit_incident_brief` — it cannot respond with plain text. This means
there's no free-text parsing anywhere in this pipeline; the model must
return `{ technical: string, executive: string }` or the call is treated as
a failure (see below).

**Validation + persistence.** `extractBriefs()` in `analysisPipeline.ts`
pulls the tool-use block out of the response and checks both fields are
strings. Two failure paths, both still write a row so the trigger is never
silently lost:
- No valid tool-use block → `INSERT ... status='failed', error='Model did not return the expected emit_incident_brief tool call'`
- Bedrock call throws → `INSERT ... status='failed', error=<exception message>`

On success: `INSERT ... status='complete'` with both briefs, the model ID,
and `input_tokens`/`output_tokens` from `response.usage`.

**PDF generation** (best-effort, after the row above already committed —
a PDF failure never affects the already-published text brief): `api/_lib/pdf/render.ts`
renders both briefs via `@react-pdf/renderer` and uploads to Vercel Blob,
then `UPDATE ... SET pdf_technical_url, pdf_executive_url`.

**Reading it back.**
- `GET /api/analysis/latest` (public, unauthenticated) — the single most
  recent `status='complete'` row for a `(provider, incidentId)`. Powers the
  dashboard's "AI Insight" panel. Deliberately returns only the latest row,
  not history — see README's Phase 2 note on why the version stepper was
  removed.
- `GET /api/admin/analysis-admin?resource=runs` (admin) — last 200 rows
  across every trigger, including failed ones. Powers `RunHistoryPanel.tsx`,
  including the manual retry action (re-enters `runIncidentAnalysis` with
  `bypassDebounce: true`, always inserting a **new** row — the original
  failed row is left untouched as an audit record).

---

## 2. The prompt itself, piece by piece

All of this lives in `api/_lib/analysisPrompt.ts`. Nothing here talks to
Bedrock or does HTTP — it's kept as plain data/logic so it can be read,
diffed, and (eventually) tested in isolation.

### 2a. System prompt — `buildSystemPrompt()`

Built fresh on every call (not cached), from a template literal array
joined with `\n`. Current content, in order:

1. **Role/task framing** — "writing incident briefs for a cloud status
   dashboard used by cloud engineering staff and executive leadership,"
   given one incident's title/status/severity/affected services & regions/
   latest update text.
2. **Per-brief instructions** — what each of the two required outputs
   should cover:
   - `technical`: which service categories to check, failover/resiliency
     questions relevant to the affected regions, concrete next actions
     ranked by urgency.
   - `executive`: plain language, no jargon — what's affected, how
     serious, customer-facing impact likelihood, what decision (if any)
     leadership needs to make.
3. **Hard rule — conditional DR language.** The model has no visibility
   into whether the reader's workloads actually have cross-region/multi-AZ
   failover configured. It's explicitly forbidden from writing an
   unconditional "fail over now" instruction, and given the exact phrasing
   pattern to use instead ("if a failover path exists, consider using it").
   This exists because an unconditional failover instruction is actively
   harmful advice for a reader whose workload isn't set up for it.
4. **Hard rule — grounding.** The model is told not to invent specific
   technical claims beyond what the incident text supports, and for
   resiliency/failover guidance it must select and adapt from a **fixed
   reference table** (below) rather than generating new claims. This is
   the main defense against an LLM inventing plausible-sounding specifics
   from what's often a thin, vague vendor paragraph.
5. **The reference table itself**, rendered into the prompt as plain text
   (category name + bullet list of questions).
6. **Disclaimer instruction** — append `DISCLAIMER_TEXT` verbatim as the
   final line of the executive brief.
7. **Tool-use instruction** — call `emit_incident_brief` exactly once, no
   plain-text response.

### 2b. The resiliency reference table — `RESILIENCY_REFERENCE_TABLE`

Hand-curated, not model-generated — this is deliberate. Five categories
today (Compute, Network, Storage, Database, Identity), each with 2-3 review
questions written to be provider-agnostic ("Is this workload spread across
multiple Availability Zones, or pinned to one?"). The model can only draw
resiliency guidance from what's here; it's not free to invent a sixth
category or a new question on the fly. This is the single highest-leverage
place to improve the *quality* of technical-brief guidance — it's reviewed,
hand-written content, not something an LLM call can silently degrade.

### 2c. User message — `buildUserMessage(provider, incident)`

Just the incident, JSON-stringified: `provider`, `title`, `status`,
`severity`, `affectedServices`, `affectedRegions`, `latestUpdate`,
`startTime`, `endTime`. Notably **not included**: `triggerEvent` (the model
currently can't tell "this is a brand-new incident" from "this is the 4th
update to an incident that's been active for a week" — see Section 4), and
no prior brief text (each call is a fresh read, there's no continuity
between a `new` brief and its `content_changed` follow-up).

### 2d. Tool schema — `buildToolConfig()`

```ts
{
  tools: [{
    toolSpec: {
      name: 'emit_incident_brief',
      description: 'Emit the technical and executive incident briefs.',
      inputSchema: { json: {
        type: 'object',
        properties: {
          technical: { type: 'string', description: '...' },
          executive: { type: 'string', description: '...' },
        },
        required: ['technical', 'executive'],
      }},
    },
  }],
  toolChoice: { tool: { name: 'emit_incident_brief' } },
}
```

Both fields are plain strings (markdown-flavored — `**bold**` spans are
parsed client-side by `formatBriefText.tsx` and server-side by
`BriefDocument.ts`'s PDF renderer). If you want structured sub-fields
(e.g. a separate `severity_assessment` field), this schema is where that
starts — see Section 4's "output shape" note on everything downstream that
assumes exactly `{technical, executive}`.

### 2e. Disclaimer — `DISCLAIMER_TEXT`

One shared constant, used in two places: appended to the executive brief's
own text (per the system prompt instruction above), and shown again in the
PDF's own recurring footer (`api/_lib/pdf/render.ts` strips a trailing
exact-match copy from the brief body before rendering, specifically to
avoid it appearing twice back-to-back on the PDF page — the dashboard
display has no such stripping, since it has no separate persistent
disclaimer element of its own).

---

## 3. How to refine safely

There's no automated eval harness for this prompt today — changes are
judged by re-running against real incident data and reading the output.
That's workable at this scale (occasional incidents, not a
high-volume classification task) but means the burden is on you to check
output quality by hand rather than a test suite catching a regression.
Suggested workflow:

1. **Edit `api/_lib/analysisPrompt.ts` locally.**
2. **Test against real incident data before touching production**, the
   same way this was verified during the PDF formatting fix earlier — a
   throwaway script using `tsx`, importing the real fetcher and pipeline
   pieces directly:
   ```ts
   // tmp-test-prompt.mjs (delete after use, don't commit)
   import { fetchAws } from './src/fetchers/awsFetcher.ts';
   import { buildSystemPrompt, buildUserMessage, buildToolConfig } from './api/_lib/analysisPrompt.ts';
   // ...call bedrock.send(new ConverseCommand({...})) directly and print the result
   ```
   This lets you compare old-prompt-output vs. new-prompt-output for the
   *same* real incident, which is the only way to tell if a prompt change
   actually improved anything.
3. **Once satisfied, deploy** (`npm run deploy`) and use the admin **Retry**
   action (Run History tab) against a real active incident to generate a
   fresh brief under the new prompt in production — this creates a new row
   without disturbing the existing one, so nothing is lost if the new
   version is worse.
4. **Consider keeping a small fixed set of past incidents as an informal
   regression set.** The two long-running Middle East region incidents
   (`incident_snapshot` column in `incident_analysis`, real historical
   data already in Postgres) are a good pair to always re-check against,
   since they're an unusually severe, detailed case — a prompt change that
   reads fine on a minor incident but goes off the rails on a "regional
   infrastructure destroyed, expect months of recovery" incident is exactly
   the kind of regression worth catching before it ships.
5. **Watch token usage.** `input_tokens`/`output_tokens` are already stored
   per row (`incident_analysis.input_tokens`/`output_tokens`) — worth a
   glance after a prompt change, since a longer system prompt or reference
   table has a real, visible cost per run.

---

## 4. Concrete refinement directions

Roughly ordered by how self-contained the change is:

- **Reference table coverage** (`RESILIENCY_REFERENCE_TABLE`). Lowest-risk,
  highest-leverage change available — add categories (CDN/edge? messaging/
  queues? container orchestration?) or refine existing questions, with zero
  risk of destabilizing the hard rules elsewhere in the prompt.
- **Tone/structure of each brief** (the per-brief bullets in
  `buildSystemPrompt()`). E.g. asking for a consistent heading structure
  per brief (`**Situation** / **Impact** / **Actions**`) so briefs are more
  scannable and visually consistent PDF-to-PDF, instead of whatever
  structure the model chooses each time.
- **Give the model `triggerEvent`.** Add it to `buildUserMessage()`'s JSON
  and instruct the prompt to write differently for `new` ("first read of
  this incident") vs. `content_changed` ("this is an update — note what
  changed if the previous brief said otherwise") vs. `resolved`
  ("summarize resolution, no further action items"). Currently every brief
  is written as if it's the first time the model has ever seen this
  incident, even on the 4th update.
- **Disclaimer wording** (`DISCLAIMER_TEXT`) — shared between the dashboard
  text and the PDF footer, so a wording change is one edit, two surfaces.
- **Output shape.** Adding a third brief variant, or splitting `technical`
  into sub-fields, means touching four places, not one: `buildToolConfig()`'s
  schema, the corresponding system-prompt instruction, `extractBriefs()` in
  `analysisPipeline.ts`, and the DB/PDF/frontend code that currently
  assumes exactly `{technical, executive}` (the `incident_analysis` table's
  `technical_brief`/`executive_brief` columns, `IncidentBriefPanel.tsx`'s
  tab UI, `BriefDocument.ts`'s two PDF variants). Worth doing eventually
  (e.g. a short "customer-facing status update" draft leadership could
  copy-paste), but scope it as its own change, not a quick prompt edit.
- **Model choice** (`BEDROCK_MODEL_ID` env var). Swapping models is a
  one-line env var change with no code impact, but re-verify grounding
  behavior specifically — the "don't invent specifics" hard rule is doing
  real work, and different model families follow forced-tool-use
  instructions with varying strictness.

---

## 5. Admin UI for live prompt customization — a scoped plan

**Goal:** let some of Section 4's changes happen without a code change +
redeploy, the same way debounce interval and the per-provider kill switch
are already live-editable (`api/_lib/analysisSettings.ts` +
`AnalysisSettingsPanel.tsx`). **This section is a plan, nothing here is
built yet.**

### What should — and shouldn't — be live-editable

Not everything in the prompt is a good candidate for a text box in an
admin page. Split by risk:

| Safe to expose live | Keep in code, PR-reviewed |
|---|---|
| Resiliency reference table content (categories/questions) | The two hard rules (conditional DR language, grounding) — these are safety-critical constraints, not stylistic choices, and should go through the same review as any other code change |
| A free-text "additional instructions" field appended to the system prompt | The tool schema / output shape — changing this requires matching changes in `extractBriefs()`, the DB columns, and the frontend, so it can't be a live text-box edit anyway |
| Disclaimer wording | `BEDROCK_MODEL_ID` — already env-var-controlled, arguably fine to leave that way (a model swap is a decision, not a tuning knob) |

Recommended scope for a first version: **just the "additional instructions"
free-text field.** It's the lowest-risk, most valuable win — lets you
nudge tone/emphasis ("keep technical briefs under 200 words," "always
mention the AWS Personal Health Dashboard for account-specific follow-up")
without a deploy, while the hard rules and reference table stay in code
where they're reviewed. Reference-table editing is a reasonable Phase 2 if
Phase 1 proves useful.

### Proposed implementation (Phase 1 — additional instructions only)

Mirrors the existing `analysisSettings.ts` pattern exactly:

**`api/_lib/analysisSettings.ts`** — add:
```ts
export const PROMPT_OVERRIDE_KEY = 'settings:analysis-prompt-instructions';

export async function getPromptOverride(): Promise<string | null> {
  try {
    const value = await redis.get<string>(PROMPT_OVERRIDE_KEY);
    return typeof value === 'string' && value.trim() ? value : null;
  } catch (err) {
    console.error('[analysisSettings] failed to read prompt override, using base prompt', err);
    return null; // fails open to the base prompt, not a broken call
  }
}
export async function setPromptOverride(text: string): Promise<void> {
  await redis.set(PROMPT_OVERRIDE_KEY, text);
}
export async function clearPromptOverride(): Promise<void> {
  await redis.del(PROMPT_OVERRIDE_KEY);
}
```

**`api/_lib/analysisPrompt.ts`** — `buildSystemPrompt()` becomes `async`,
takes the override as a parameter (keep it a pure function — don't reach
into Redis from inside this file, matching this file's existing "no HTTP
or SDK imports" convention), and appends it as a clearly-delimited final
section:
```ts
export function buildSystemPrompt(additionalInstructions?: string | null): string {
  const base = [ /* existing array */ ].join('\n');
  if (!additionalInstructions) return base;
  return `${base}\n\nAdditional instructions from the site operator:\n${additionalInstructions}`;
}
```

**`api/_lib/analysisPipeline.ts`** — fetch the override alongside the
existing debounce lookup and pass it through:
```ts
const promptOverride = await getPromptOverride();
// ...
system: [{ text: buildSystemPrompt(promptOverride) }],
```

**`api/admin/analysis-admin.ts`** — extend the existing action dispatch
(same endpoint, not a new route — this project's Vercel Hobby plan caps at
12 Serverless Functions, already tight; see README's Phase 4 notes on why
run-history/retry/settings all share this one file):
- `GET` response gains `promptOverride: string | null`
- New `PATCH` actions `set_prompt_override` / `clear_prompt_override`,
  same shape as the existing `set_debounce`/`clear_debounce` pair

**`src/components/admin/AnalysisSettingsPanel.tsx`** — new card, same
visual pattern as the existing debounce card (`fieldStyle`/`cardStyle`/
`primaryBtnStyle` already defined in this file): a `<textarea>`, a **Save**
button, and a **Reset to default** ghost button, with the same
saving/message state pattern already used for `saveDebounce()`.

### Worth adding even in Phase 1: a preview, not just a save

Saving a prompt change blind (it only shows up the next time an incident
actually triggers analysis) makes iteration slow. Two options, in order of
effort:
1. **Cheapest:** a "Preview" button that calls a small new endpoint running
   `buildSystemPrompt(draftText)` + `buildUserMessage()` against the most
   recent real incident snapshot already in Postgres, without touching
   Redis or making a Bedrock call — just shows the *assembled prompt text*
   so you can sanity-check the instructions render the way you expect
   before saving.
2. **More useful, more work:** an actual dry-run Bedrock call against a
   real incident, returning the generated briefs without persisting them.
   This needs a small refactor to `runIncidentAnalysis()` (a `dryRun` flag
   that skips the `INSERT`/PDF steps and just returns `{technical,
   executive}`), since today the function always persists on success. This
   is the more valuable option — it answers "did my instruction actually
   change the output" rather than just "did I typo the text box" — but
   it's a real Bedrock call each time you click Preview, so it should
   probably still require an explicit click, not fire on every keystroke.

### Open questions to resolve before building this

- Should the prompt override apply globally, or per-provider (e.g.
  different additional instructions for AWS vs. Azure, given how different
  their feed granularity already is)? Global is simpler; per-provider
  matches how `analysisSettings.ts` already treats the disabled-providers
  list as a per-provider concept.
- Should saving a new override log who changed it and when? There's no
  audit trail today for the existing debounce/kill-switch settings either
  (`analysis-admin.ts`'s `PATCH` handlers don't record an actor), so this
  would be a small step up from existing precedent, not a regression —
  worth deciding whether it's worth the extra column/table before building
  it, or deferring until the lack of an audit trail actually causes a real
  problem.
- Should there be a length cap on the override text? An unbounded
  "additional instructions" field is still user input flowing into an LLM
  prompt — not a security concern (see README's precedent on this), but an
  extremely long override could meaningfully affect the token cost of
  every single incident analysis run going forward, which is worth a
  sanity-check length limit (a few hundred words) rather than no limit at
  all.
