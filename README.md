# Cloud Status Hub

Real-time operational status dashboard for AWS, Azure, OCI, and GCP in a single unified view. Built for Marsh internal leadership and cloud engineering staff.

Auto-refreshes every 60 seconds. Shows active incidents, per-service health, and links through to official vendor status pages. Subscribers can also opt in to email alerts when a provider they follow reports a new outage — see [Alerts & Admin](#alerts--admin) below.

> **Status:** Live on Vercel — [cloudstatus.synepho.com](https://cloudstatus.synepho.com) (the old `csp-status-hub.vercel.app` URL still works — permanent redirect, see [docs/CUSTOM-DOMAIN-PLAN.md](./docs/CUSTOM-DOMAIN-PLAN.md))

---

## Architecture

```
Browser (React SPA)
        │
        ├─── Direct fetch (CORS-permissive) ─────────────────────────────┐
        │    AWS   → https://status.aws.amazon.com/rss/all.rss           │
        │    OCI   → https://ocistatus.oraclecloud.com/api/v2/status.json│
        │             + api/v2/incident-summary.rss (per-incident detail)│
        │    GCP   → https://status.cloud.google.com/incidents.json      │
        │                                                                 │
        └─── Serverless proxy ──────────────────────────────────────────┘
             Azure only: /api/status/azure
                   └─→ Vercel Function (Node.js, cached s-maxage=300)
                          └─→ rssfeed.azure.status.microsoft/en-us/status/feed/
                                (RSS/XML → parsed → region × service breakdown → normalized JSON)

┌─────────────────────────────────────────────────────────────────────┐
│  useStatusPolling (React hook)                                      │
│  ┌──────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────┐          │
│  │awsFetcher│ │azureFetcher  │ │ociFetcher│ │gcpFetcher│          │
│  └────┬─────┘ └──────┬───────┘ └────┬─────┘ └────┬─────┘          │
│       └──────────────┴──────────────┴─────────────┘                │
│         each wrapped in withTimeout() (12s) and settled            │
│         independently — a card renders the instant its own         │
│         fetch resolves, a slow/hung provider only blocks itself    │
│                    → per-provider ProviderStatus map (unified schema)│
│                    → localStorage cache (60s TTL)                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  UI Layout                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ StatusHeader: title · live indicator · refresh · settings   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌──────────┬──────────┬──────────┬──────────────────────────┐    │
│  │ AWS      │ Azure    │ OCI      │ GCP                      │    │
│  │ Panel    │ Panel    │ Panel    │ Panel                    │    │
│  │ services │ services │ services │ services                 │    │
│  └──────────┴──────────┴──────────┴──────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ IncidentList: active + recently resolved incidents          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

This diagram covers the live dashboard's own data path. Alerts and admin
tooling sit behind it as a separate backend — see
[Alerts & Admin](#alerts--admin) for that architecture.

---

## Tech Stack

| Layer            | Technology                                       |
| ----------------- | ------------------------------------------------- |
| Frontend          | React 18 + Vite 6                                 |
| Language           | TypeScript 5.6                                     |
| Styling            | Tailwind CSS 3 (dark mode via `class` strategy, plus a system-preference mode) |
| XML Parsing        | `fast-xml-parser` 5 (browser + serverless)         |
| Serverless          | Vercel Functions (Node.js, auto-detected)          |
| Database            | Neon Postgres (Vercel Marketplace)                 |
| Cache               | Upstash Redis (Vercel Marketplace)                 |
| Email               | Resend                                             |
| AI / LLM            | AWS Bedrock — Claude Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`, cross-region inference profile), via Vercel-native OIDC → AWS federation — see [Incident Briefing Engine](#incident-briefing-engine-phases-1-4-complete) |
| PDF Generation       | `@react-pdf/renderer`, uploaded to Vercel Blob (public, 1-year immutable cache) |
| Admin Auth           | Sign in with Vercel (OAuth, PKCE)                  |
| Deployment          | Vercel (Vite SPA + `/api` routes)                  |
| Analytics           | Vercel Web Analytics + Speed Insights              |

---

## Data Sources

| Provider | Dashboard                          | Data URL                           | Format   | CORS       | Proxy               |
| -------- | ----------------------------------- | ----------------------------------- | -------- | ----------- | -------------------- |
| AWS      | https://status.aws.amazon.com/     | `.../rss/all.rss`                  | RSS/XML  | ✅ Direct  | None                |
| Azure    | https://azure.status.microsoft/    | `rssfeed.azure.status.microsoft/...` | RSS/XML  | ❌ Blocked | `/api/status/azure` |
| OCI      | https://ocistatus.oraclecloud.com/ | `.../api/v2/status.json` + `.../api/v2/incident-summary.rss` | JSON + RSS | ✅ Direct  | None                |
| GCP      | https://status.cloud.google.com/   | `.../incidents.json`               | JSON     | ✅ Direct  | None                |

**Coverage notes:**

- **AWS** — `all.rss` covers only incidents AWS publishes publicly (significant/widespread events). Minor single-service degradations appear only in per-service feeds.
- **Azure** — Public RSS feed covers only major widespread incidents. Affected services and regions are extracted from structured `<category>` elements (or title text as a fallback) and rolled up into a region × service breakdown, same as AWS/GCP/OCI — matched against a canonical top-10 service list by keyword, with anything else collapsed into a "Multiple Services *" row. Still bounded by whatever Microsoft's feed itself names; full authenticated-account granularity would require the Azure Service Health ARM API.
- **OCI** — `status.json` is only a bare `{indicator, description}` summary (no incident-level data); `incident-summary.rss` supplies one persistent, stable-guid `<item>` per incident (no dedup pass needed, unlike AWS), with region/service parsed from its `"{service} | {region} | {ref}"` title format.

---

## Provider Order

Panels and data are always returned in this order: **AWS → Azure → OCI → GCP**

---

## Alerts & Admin

Opt-in email alerting: sign up (bell icon), confirm via email, get notified
the moment a provider you follow reports a new incident — or when one
resolves. Live in production, alongside a session-gated admin view.

| Route | Purpose |
| --- | --- |
| `/` (bell icon) | Sign up — name, email, provider checkboxes, invisible bot check |
| `/manage?token=...` | Edit providers or unsubscribe (link comes from your confirmation email) |
| `/admin` | Subscriber list, search/filter, CSV export, manual actions, ad hoc test-email tool — gated behind Sign in with Vercel |

### Backend architecture

```
┌──────────────────────────────┐
│  React SPA                    │
│  /  (bell icon → sign-up)      │
│  /manage?token=... (edit/unsub)│
│  /admin (Sign in with Vercel) │
└──────────────┬─────────────────┘
               │ POST/GET
               ▼
┌───────────────────────────────────────────────────────────────────┐
│  Vercel Serverless Functions                                        │
│  /api/subscribe             create/stage a subscription (BotID-gated)│
│  /api/subscribe/confirm     finalize signup or a staged update       │
│  /api/subscribe/manage      view/edit providers (token-authed)       │
│  /api/subscribe/unsubscribe one-click, idempotent opt-out            │
│  /api/auth/*                 Sign in with Vercel (PKCE) + session     │
│  /api/admin/subscribers*     list/filter/CSV/actions (session-gated)  │
│  /api/admin/test-email       ad hoc template preview (session-gated)  │
│  /api/cron/check-status      status diff + notification dispatch      │
│  /api/cron/cleanup           daily retention purge                    │
└───────┬────────────────┬────────────────┬─────────────────┬─────────┘
        │                │                │                 │
        ▼                ▼                ▼                 ▼
 ┌─────────────┐  ┌───────────────┐  ┌───────────┐  ┌────────────────┐
 │Neon Postgres │  │ Upstash Redis  │  │  Resend   │  │ Vercel Firewall │
 │ subscribers  │  │ per-provider   │  │ transact-  │  │ rate limit on   │
 │ notification_│  │ status snapshot│  │ ional +    │  │ /api/subscribe  │
 │ log          │  │ (5-min cron    │  │ outage/    │  │ 5 req/60s/IP    │
 │              │  │ diff cache)    │  │ resolution │  │                 │
 │              │  │                │  │ email, from│  │                 │
 │              │  │                │  │ alerts.    │  │                 │
 │              │  │                │  │ synepho.com│  │                 │
 └─────────────┘  └───────────────┘  └───────────┘  └────────────────┘
                          ▲
                          │ every 5 min
              ┌────────────────────────────┐
              │ AWS EventBridge Rule         │
              │ → API Destination (HTTPS)    │
              │ → Authorization: Bearer       │
              │   $CRON_SECRET                │
              │ (Vercel native daily cron =   │
              │  free fallback, Hobby-safe)   │
              └────────────────────────────┘
```

### Data model

```sql
CREATE TABLE subscribers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE,
  phone              TEXT,
  providers          TEXT[] NOT NULL,       -- e.g. {aws,gcp} or the {'all'} sentinel
  pending_providers  TEXT[],                -- staged change awaiting re-confirmation
  status             TEXT NOT NULL DEFAULT 'pending_confirmation',
                     -- pending_confirmation | confirmed | unsubscribed
  email_verified_at  TIMESTAMPTZ,
  confirm_token      TEXT,
  confirm_token_expires_at TIMESTAMPTZ,
  manage_token       TEXT UNIQUE,           -- regenerated every time a row (re)confirms
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at    TIMESTAMPTZ
);

CREATE TABLE notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  channel       TEXT NOT NULL,
  event_type    TEXT NOT NULL,              -- new_incident | incident_resolved
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  success       BOOLEAN NOT NULL
);
```

One person, one row — a subscriber's email and provider selection live
together; `pending_providers` holds a staged edit awaiting re-confirmation
(see the sign-up flow below). `"all"` is stored as a literal sentinel rather
than expanded to all four, so future providers get included automatically.

Per-provider **status snapshot state** (used for change detection) lives in
**Upstash Redis**, not Postgres — one key per provider (`snapshot:<provider>`),
read/written on every 5-minute cron tick. An earlier `provider_status_snapshot`
Postgres table did this instead, but querying it every 5 minutes, 24/7, kept
Neon's compute from ever autosuspending and blew through the Free plan's
100 CU-hr/month allowance. Redis is billed by request count, not
compute-uptime, so a workload that's cheap-but-constant no longer burns a
metered resource just by staying alive. The old table is left in place
(unused) rather than dropped, as a historical record.

**Confirmed fix, via Neon's usage panel:** July (pre-fix, hit the cap on Jul 29)
used 102 of the 100 CU-hr Free plan allowance — ≈3.52 CU-hr/day averaged over
the month. August (post-fix) sat at 0.36 CU-hr through Aug 7 — ≈0.051
CU-hr/day, a ~69x drop — projecting to roughly 1.6 CU-hr for the full month.

### Sign-up & confirmation (double opt-in)

- Bell icon opens a form (name, email, provider checkboxes) gated by an
  invisible **Vercel BotID** check on the `POST /api/subscribe` handler.
- New sign-ups **and** any provider change to an already-confirmed
  subscription require clicking a confirmation link before taking effect —
  the public form is unauthenticated, so a change here always needs
  re-verification. Resubmitting with an email already `pending_confirmation`
  just reissues the same confirm link; resubmitting an `unsubscribed` email
  resets it as a fresh sign-up.
- A **welcome email**, sent once right after first confirmation, carries the
  `/manage` and unsubscribe links — `manage_token` doesn't exist until that
  point, so it can't be included in the original confirmation email.
- Editing via `/manage?token=...` takes effect immediately, no
  re-confirmation — the token itself already proves inbox ownership, unlike
  the public sign-up form.
- The email's "Unsubscribe" link lands on `/manage?token=...&action=unsubscribe`
  with a confirmation panel (Cancel / "Yes, unsubscribe") rather than
  unsubscribing directly on click — still one click past the email
  (CAN-SPAM's "one step" requirement), but immune to an automated
  link-scanner silently unsubscribing someone by prefetching a raw mutating
  URL. The underlying `GET /api/subscribe/unsubscribe` endpoint stays
  idempotent; it's just no longer linked to directly from outside the app.

### Change detection & notification dispatch

- `/api/cron/check-status` runs the same four fetchers the live dashboard
  uses, then diffs each provider's fresh incident list against its Redis
  snapshot.
- **Notify-worthy = a new incident ID appears** that wasn't in the previous
  snapshot — not simply "overall status went non-operational." A status-gated
  trigger would miss a brand-new incident while an unrelated one is already
  keeping that provider non-operational; ID diffing catches new incidents
  independent of whatever else is ongoing. The very first check ever
  recorded for a provider is a baseline only, not a notification trigger.
- **Resolution notifications** are the mirror case: any ID present in the
  last snapshot but missing from the fresh fetch is treated as resolved and
  triggers a separate resolution email. Works whether a provider publishes
  an explicit resolved marker or just silently drops the entry once cleared.
- Confirmed subscribers following the affected provider (or `"all"`) are
  emailed in parallel via Resend; every attempt — success or failure — is
  logged to `notification_log`. Outage and resolution emails both list the
  affected region(s) alongside the incident title.
- **Cadence:** an AWS EventBridge Rule triggers `check-status` every 5
  minutes via an API Destination (`Authorization: Bearer $CRON_SECRET`) —
  Vercel Hobby's native cron caps at once/day, too coarse for alerting.
  Vercel's own daily cron stays wired as a free, redundant fallback.
  Provisioned via `scripts/setup-eventbridge-cron.sh` (idempotent,
  self-heals if the target endpoint or rule description drift — see
  **Known constraints** below).

### Incident Briefing Engine (Phases 1-4, complete)

AI-generated technical + executive briefs per incident, built on AWS Bedrock
(Claude Sonnet 4.5), surfaced on the dashboard and downloadable as branded
PDFs. Full design in the artifact-linked design doc. For a deeper walkthrough
of the prompt itself, how to iterate on it, and a scoped plan for exposing
some of it through an admin UI, see
[`docs/PROMPT-REFINEMENT-GUIDE.md`](./docs/PROMPT-REFINEMENT-GUIDE.md).

#### Architecture — Bedrock, Claude, and the AI Insight workflow

```
check-status.ts (EventBridge, every 5 min)
        │  diffs the new provider snapshot against Redis, same tick that
        │  drives outage/resolution emails (see Change detection above)
        │
        ├─ per changed incident: new / content_changed / resolved?
        │       (content-hash trigger, independent of the notify-worthy
        │        diff — catches a vendor editing incident text in place)
        │
        └─ waitUntil(fetch('/api/analysis/run')) ── fire-and-forget,
           AFTER notifySubscribers() has already been called, so a slow
           or failed Bedrock call can never delay/block an outage email
                │
                ▼
   /api/analysis/run  (CRON_SECRET-gated; admin retry re-enters the same
        │              pipeline via bypassDebounce, see Admin controls below)
        │  debounce check: MAX(created_at) per (provider, incidentId) vs.
        │  settings:analysis-debounce-minutes (Redis, live-editable) or
        │  ANALYSIS_DEBOUNCE_MINUTES (env default, 30 min)
        ▼
   api/_lib/analysisPipeline.ts → runIncidentAnalysis()
        │
        │  1. buildSystemPrompt() + buildUserMessage(provider, incident)
        │     (api/_lib/analysisPrompt.ts) — includes a hand-curated
        │     per-service-category resiliency reference table so the
        │     model cites reviewed guidance instead of inventing specifics
        │     from a thin vendor paragraph, and a hard rule keeping
        │     DR/failover language conditional
        │
        ▼
   AWS Bedrock — ConverseCommand
        │  Auth: Vercel OIDC → sts:AssumeRoleWithWebIdentity (no static
        │  AWS keys) via @vercel/oidc-aws-credentials-provider, role from
        │  scripts/setup-bedrock-oidc.sh (api/_lib/bedrock.ts)
        │  Model: BEDROCK_MODEL_ID — a cross-region inference profile ID,
        │  not a bare on-demand model ID (Claude models on Bedrock only
        │  support INFERENCE_PROFILE invocation). Currently
        │  us.anthropic.claude-sonnet-4-5-20250929-v1:0 — the code
        │  default (bedrock.ts) is us.anthropic.claude-sonnet-5, but that
        │  model returns AccessDeniedException on this AWS account
        │  pending a Sales-approved allowlist request, so the env var
        │  override pins the working Sonnet 4.5 profile instead
        │  Forced tool-use: toolConfig requires the emit_incident_brief
        │  tool (buildToolConfig()) so the model must return schema-shaped
        │  { technical: string, executive: string } — no free-text
        │  parsing, one round trip for both brief variants
        ▼
   extractBriefs() validates the tool-use block, then:
        │
        ├─ INSERT into incident_analysis (Postgres/Neon) — technical_brief,
        │  executive_brief, model id, input/output token counts,
        │  status='complete' (or 'failed' with the error, on a missing
        │  tool-use response or a thrown Bedrock error — the trigger is
        │  never lost silently)
        │
        └─ best-effort, AFTER the row above already committed:
           renderAndUploadBriefPdfs() → @react-pdf/renderer → Vercel Blob
           (public, 1-year immutable cache) → UPDATE ...SET pdf_*_url
           (a PDF failure never affects the already-published text brief)

   Reading it back:
        GET /api/analysis/latest  (public) → single latest complete row
             → IncidentBriefPanel.tsx's "AI Insight" panel + Download PDF
        GET /api/admin/analysis-admin?resource=runs  (admin) → full history
             across every trigger, incl. failed rows → RunHistoryPanel.tsx
             (manual retry re-enters runIncidentAnalysis with
             bypassDebounce: true)
```

- **Trigger, layered on top of the notify-worthy diff above:**
  `check-status.ts` also hashes each active incident's
  `status + latestUpdate + affectedServices + affectedRegions` and stores the
  hash per incident ID in the same Redis snapshot
  (`activeIncidentContentHashes`). An incident is `new` (same predicate as
  the notify-worthy diff), `content_changed` (ID was already active but its
  hash changed — catches a vendor editing an ongoing incident's text without
  the ID changing), or `resolved` (same predicate as the resolution diff).
- **Never in the critical path of an outage email.** For every
  new/content_changed/resolved incident, `check-status.ts` fires one
  `waitUntil(fetch('/api/analysis/run', ...))` per incident — never awaited,
  placed after the existing `notifySubscribers()` calls — so a slow or
  failed Bedrock call can't delay or block a notification.
- **`/api/analysis/run`** debounces (default 30 min per incident, a live
  Redis override `settings:analysis-debounce-minutes` beats the
  `ANALYSIS_DEBOUNCE_MINUTES` env default without a redeploy), then calls
  Bedrock's Converse API (`BEDROCK_MODEL_ID`, a cross-region inference
  profile — Claude models have no bare on-demand ID on Bedrock; currently
  `us.anthropic.claude-sonnet-4-5-20250929-v1:0` — Claude Sonnet 5 itself
  returns `AccessDeniedException` on this account pending an AWS
  Sales-approved allowlist request, confirmed by other Claude models
  invoking successfully) with a forced tool-use call (`emit_incident_brief`)
  to get schema-shaped `{technical, executive}` briefs in one request. A
  hand-curated per-service-category resiliency reference table
  (`api/_lib/analysisPrompt.ts`) keeps the model selecting from reviewed
  guidance instead of inventing specifics from a thin vendor paragraph, and
  a hard prompt rule keeps DR/failover language conditional ("if a failover
  path exists, consider...") rather than a blanket instruction to fail over.
- **Auth to Bedrock:** Vercel's native OIDC → AWS federation
  (`sts:AssumeRoleWithWebIdentity` via `@vercel/oidc-aws-credentials-provider`)
  — no static AWS keys, matching this account's OIDC-over-static-keys
  standard. IAM OIDC provider + role provisioned via
  `scripts/setup-bedrock-oidc.sh` (idempotent, mirrors
  `scripts/setup-eventbridge-cron.sh`'s structure).
- **Storage:** one row per trigger (not per incident) in Postgres'
  `incident_analysis` table — an incident accumulates rows across its
  lifecycle, and the debounce check reads `MAX(created_at)` per
  `(provider, incident_id)`. A failed run (Bedrock error, malformed
  tool-use response) still writes a `status='failed'` row with the error
  message rather than losing the trigger silently.
- **Reading it back (Phase 2, revised 2026-08-29):** `GET /api/analysis/latest`
  is a public, unauthenticated, CDN-cached endpoint (no Redis layer — it
  only fires on-demand when a user expands a panel, not on every 60s poll)
  returning just the single most recent `status='complete'` row for a
  `(provider, incidentId)`. The dashboard's "AI Insight" panel
  (`IncidentBriefPanel.tsx`) lazy-fetches this on first expand — zero
  requests fire until a user actually opens it — with a Technical/Executive
  toggle. Older versions for the same incident still exist in Postgres
  (used by admin run history / retry), but the dashboard only ever shows
  the latest one — no version stepper, since a stale prior version reads
  as contradicting the incident's current live status.
- **PDF export (Phase 3):** generated once per analysis version, right
  after the text brief succeeds, as a best-effort step that can never
  affect the already-published text (`api/_lib/pdf/render.ts`). Built with
  `@react-pdf/renderer` (Helvetica built-in fonts, no external font-file
  fetch), Synepho-branded, uploaded to Vercel Blob at
  `incident-analysis/{provider}/{slugified-incident-id}/{row-id}-{technical|executive}.pdf`
  with a 1-year immutable `Cache-Control` — the row's own UUID guarantees
  the path is unique, so nothing already published is ever overwritten. A
  fixed footer repeats on every page: the disclaimer, plus (added
  2026-08-29) a "Powered by Synepho — for live status and updates, visit
  cloudstatus.synepho.com" line so a page reads correctly even if printed
  or forwarded on its own. The dashboard only shows a "Download PDF" link
  once a URL exists — pre-Phase-3 rows and any PDF-generation failure both
  render nothing rather than a broken link.
  - **Spacing fix (2026-08-29):** `renderBriefBody()` originally rendered
    every line of the brief as its own block-level `<Text>`, so
    `line-height` and `margin-bottom` both applied per line instead of
    per paragraph — every multi-line section (e.g. adjacent bullets) read
    as double-spaced. Now splits on real blank-line paragraph breaks only,
    joining each paragraph's own lines with a literal `\n` inside one
    `<Text>`. Also fixed the executive PDF repeating its closing
    disclaimer twice (the prompt already appends it as the brief's own
    final line, on top of the PDF's separate recurring footer) by
    stripping a trailing exact-match copy before rendering.
- **Email link (Phase 4):** outage/resolution emails link each incident to
  `${APP_BASE_URL}/?provider=...&incidentId=...` — a stable dashboard
  deep-link rather than a PDF/brief snapshot at send time, since brief
  generation is async and hasn't run yet when the email goes out (the
  fire-and-forget analysis trigger fires *after* `notifySubscribers()`
  completes in the same tick). `useIncidentDeepLink` (`src/hooks/`) parses
  the params once on load, strips them from the URL, and scrolls to and
  auto-expands the matching incident's AI Insight panel once real data has
  loaded; silently no-ops if the incident's since rolled off the feed.
- **Admin controls (Phase 4):** a single `api/admin/analysis-admin.ts`
  endpoint (merged from what would otherwise be three routes — this
  project's Vercel Hobby plan caps at 12 Serverless Functions per
  deployment, and three separate routes would have exceeded it) backs three
  admin-only surfaces: run history (last 200 `incident_analysis` rows,
  client-side filtered), a manual re-run action available on every row
  regardless of status — not just `status='failed'` ones, so a `complete`
  row can be forced to regenerate too, e.g. to pick up a prompt change for
  an incident that's still active (reruns the shared pipeline with
  `bypassDebounce: true`, always inserting a new row rather than mutating
  the one it was triggered from), and live settings — the
  debounce interval and a per-provider kill switch
  (`settings:analysis-disabled-providers` in Redis, read once per cron
  tick, fails open on a Redis error so a hiccup can't silently stop
  analysis for every provider). The kill switch only gates the analysis
  trigger — outage/resolution emails keep sending normally for a
  "disabled" provider, since it's a Bedrock-cost control, not a monitoring
  pause. The Bedrock/PDF pipeline itself lives in
  `api/_lib/analysisPipeline.ts`, shared between `/api/analysis/run` (the
  CRON_SECRET-gated fire-and-forget path) and the admin retry action (the
  `requireAdmin`-gated path) so neither duplicates the ~80 lines of
  Bedrock/Postgres/PDF logic.

### Admin

- **Auth:** Sign in with Vercel (OAuth, PKCE). Any Vercel user can complete
  the OAuth flow — the actual access boundary is the app's own check: the
  callback decodes the `id_token` and compares its `email` claim against a
  single hardcoded `ADMIN_EMAIL`, bouncing anyone else with `?error=forbidden`.
  A separate HMAC-signed session cookie (7-day expiry) is then issued,
  decoupled from Vercel's own 1-hour access-token lifetime.
- **List/search/filter:** `GET /api/admin/subscribers` — `status`,
  `provider`, and `q` (name/email substring) query params.
- **CSV export:** same endpoint, `?format=csv`, respects active filters.
- **Manual actions:** `PATCH /api/admin/subscribers/[id]` —
  `resend_confirmation` / `force_unsubscribe`; `DELETE` for a hard delete.
- **Ad hoc test email:** `/api/admin/test-email` — preview any notification
  template against a real confirmed subscriber's address, from the admin UI.

### Backend pieces

- **Neon Postgres** (Vercel Marketplace) — `subscribers` and `notification_log`
- **Upstash Redis** (Vercel Marketplace) — per-provider status snapshot cache for change detection
- **Resend** — transactional + outage/resolution email, from `alerts.synepho.com`
- **Vercel BotID** — invisible bot check on the sign-up form
- **Sign in with Vercel** — admin auth, restricted to a single hardcoded `ADMIN_EMAIL`
- **AWS EventBridge** (Rule + Connection + API Destination) — triggers `/api/cron/check-status` every 5 minutes; provisioned via `scripts/setup-eventbridge-cron.sh`
- **AWS Bedrock** — Claude Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`, a cross-region inference profile — Claude models have no bare on-demand ID on Bedrock), via Vercel OIDC federation, no static AWS keys — powers the Incident Briefing Engine's `/api/analysis/run`; IAM role provisioned via `scripts/setup-bedrock-oidc.sh`. `BEDROCK_MODEL_ID` env var overrides the code default of `us.anthropic.claude-sonnet-5`, which returns `AccessDeniedException` on this AWS account pending a Sales-approved allowlist request
- **Vercel Blob** — stores the branded PDF briefs from Phase 3, public access, 1-year immutable cache
- **Vercel Firewall** — rate limiting on the sign-up endpoint (5 req/60s/IP)
- **AWS Route 53** (`synepho.com` zone) — pre-existing DNS, also hosts Resend's domain-verification records

| Piece | Status |
| --- | --- |
| Database — Neon Postgres | Live |
| Status snapshot cache — Upstash Redis | Live |
| Email — Resend | Live, domain verified |
| SMS — Twilio | Not built (deferred, Twilio A2P 10DLC registration) |
| Bot protection — Vercel BotID | Live |
| Admin auth — Sign in with Vercel + custom session | Live |
| Cron (primary) — AWS EventBridge | Live |
| Cron (fallback) — Vercel native daily cron | Live |
| Rate limiting — Vercel Firewall | Live |
| Incident Briefing Engine — AWS Bedrock + Vercel Blob | Phases 1-4, complete |

Everything above runs on a free tier.

**Environment variables** (see `.env.local`, gitignored — pull with `vercel env pull`):
`DATABASE_URL`, `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN`, `APP_BASE_URL`, `CRON_SECRET`, `VERCEL_OAUTH_CLIENT_ID`, `VERCEL_OAUTH_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_EMAIL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`.

**Incident Briefing Engine env vars** (see `scripts/setup-bedrock-oidc.sh`'s
output for `AWS_ROLE_ARN`): `AWS_ROLE_ARN`, `AWS_REGION` (pin explicitly to
`us-east-1` — Vercel can auto-inject a value that drifts under multi-region
routing), `BEDROCK_MODEL_ID` (optional, defaults to
`us.anthropic.claude-sonnet-5` in code; currently overridden to
`us.anthropic.claude-sonnet-4-5-20250929-v1:0` in production — see above),
`ANALYSIS_DEBOUNCE_MINUTES` (optional, defaults to `30`; the live Redis key
`settings:analysis-debounce-minutes` overrides it without a redeploy),
`BLOB_READ_WRITE_TOKEN` (auto-injected once a Vercel Blob store is
connected to the project — see `vercel blob create-store`).

**Database migrations** live in `scripts/db/*.sql`, applied via:
```bash
vercel env pull .env.local
set -a && source .env.local && set +a
node scripts/db-migrate.mjs
```
Redis needs no migration step — it's just a key-value cache, provisioned once via the Vercel Marketplace integration.

### Known constraints

- **EventBridge's target endpoint is a literal value, not driven by
  `APP_BASE_URL`.** It lives in the live AWS API Destination resource and in
  `scripts/setup-eventbridge-cron.sh`'s `TARGET_ENDPOINT` constant, outside
  the app's own deploy. Any future domain change must re-run that script —
  it self-heals drift on the endpoint and the rule description instead of
  skipping when the resource already exists, but only if it's actually run.
- **Bracket-syntax dynamic routes (`api/admin/subscribers/[id].ts`) aren't
  auto-wired outside Next.js.** A Vite project needs an explicit `vercel.json`
  rewrite (`/api/admin/subscribers/:id` → `/api/admin/subscribers/[id]`) —
  already in place, but worth knowing before adding another bracket route.
- **Diffing-and-dispatching endpoints aren't safe read-only healthchecks.**
  `check-status` both detects state changes *and* sends real emails on a
  detected change in the same request — curling it manually to "just check"
  can trigger live notifications if something genuinely changed since the
  last tick.

---

## Project Structure

```
csp-status-hub/
├── api/                           Vercel serverless functions
│   ├── status/
│   │   └── azure.ts               Azure Atom feed proxy (fetch, parse, normalize)
│   ├── subscribe/
│   │   ├── index.ts               POST — create/stage a subscription
│   │   ├── confirm.ts             GET  — finalize signup or a staged update
│   │   ├── manage.ts              GET/POST — view/edit providers by token
│   │   └── unsubscribe.ts         GET  — one-click, idempotent opt-out
│   ├── auth/
│   │   ├── authorize.ts           GET  — start Sign in with Vercel (PKCE)
│   │   ├── callback.ts            GET  — token exchange, email allowlist check, session cookie
│   │   └── signout.ts             POST — clear session cookie
│   ├── admin/
│   │   ├── subscribers/
│   │   │   ├── index.ts           GET  — list/filter/CSV export + summary counts
│   │   │   └── [id].ts            PATCH/DELETE — resend/unsubscribe/delete
│   │   └── test-email.ts          POST — send an ad hoc template preview to a confirmed subscriber
│   ├── cron/
│   │   ├── check-status.ts        Status diffing + notification dispatch (EventBridge + Vercel cron)
│   │   └── cleanup.ts             Daily retention purge (unconfirmed 7d, unsubscribed 90d)
│   └── _lib/
│       ├── types.ts               Re-exports shared types for API functions
│       ├── db.ts                  Neon client
│       ├── redis.ts               Upstash Redis client + status-snapshot helpers
│       ├── email.ts               Resend templates (confirm, update-confirm, welcome, outage, resolution)
│       ├── azureFetcher.ts        Azure fetch/parse logic shared by api/status/azure.ts and the cron job
│       ├── auth.ts                requireAdmin() session gate
│       ├── session.ts             HMAC-signed admin session cookie (sign/verify)
│       └── cookies.ts             Cookie header parsing
│
├── src/
│   ├── App.tsx                    Root layout, dynamic title, Analytics, SpeedInsights
│   ├── main.tsx                   React entry point + path-based routing (/, /manage, /admin)
│   ├── botid.ts                   Client-side BotID init, protects POST /api/subscribe
│   ├── components/
│   │   ├── StatusHeader.tsx       Header: title, live dot, refresh, bell (subscribe), Settings menu
│   │   ├── SettingsMenu.tsx       Appearance (light/dark/system), About, Buy Me a Coffee
│   │   ├── AboutModal.tsx         About dialog: description, creator credit, version/build info
│   │   ├── ProviderGrid.tsx       4-column responsive grid; renders a skeleton slot for any provider still loading
│   │   ├── ProviderCardSkeleton.tsx  Single-card loading placeholder, shown per-slot until that provider's fetch resolves
│   │   ├── ProviderPanel.tsx      Per-provider expandable card + service list
│   │   ├── RegionTable.tsx        Region → top-10 service status rows (all four providers)
│   │   ├── FlatServiceList.tsx    Flat top-10 list for the no-active-incident state (no regions to show yet)
│   │   ├── IncidentList.tsx       Active + recently resolved incidents, sorted by recency
│   │   ├── IncidentCard.tsx       Per-incident detail row with severity and link
│   │   ├── StatusBadge.tsx        Color-coded status pill
│   │   ├── ServiceRow.tsx         Single service row in region view
│   │   ├── ErrorState.tsx         Per-provider fetch failure fallback
│   │   ├── SubscribeModal.tsx     Sign-up form (name, email, provider checkboxes)
│   │   ├── ManagePage.tsx         /manage — edit providers, confirm-before-unsubscribe
│   │   └── AdminPage.tsx          /admin — subscriber list, filters, CSV export, actions, test-email tool
│   ├── fetchers/
│   │   ├── awsFetcher.ts          RSS parse + GUID parsing + deduplication
│   │   ├── azureFetcher.ts        Calls /api/status/azure proxy, normalizes response
│   │   ├── gcpFetcher.ts          incidents.json → normalized schema
│   │   └── ociFetcher.ts          status.json + incident-summary.rss → normalized schema
│   ├── hooks/
│   │   ├── useStatusPolling.ts    60s polling, cooldown, offline detection, 60s cache; tracks each provider independently so one slow/failed fetch doesn't block the others
│   │   ├── useTheme.ts            Light/dark/system appearance mode, localStorage persistence
│   │   └── useVersionCheck.ts     Polls dist/version.json vs. the running bundle's build date; flags a stale long-open tab after a new deploy
│   ├── types/
│   │   └── status.ts              Unified schema (StatusLevel, ProviderStatus, etc.)
│   └── utils/
│       ├── awsServices.ts         AWS top-10 canonical service list
│       ├── azureServices.ts       Azure top-10 canonical service list + keyword matchers
│       ├── gcpServices.ts         GCP top-10 canonical service list
│       ├── ociServices.ts         OCI top-10 canonical service list + keyword matchers
│       ├── statusHelpers.ts       Status → color/label/dot mapping
│       ├── formatters.ts          Relative/absolute time formatting
│       └── withTimeout.ts         Races a fetch against a timeout (12s) so one hung provider can't stall the page
│
├── scripts/
│   ├── db/*.sql                   Migrations, applied in filename order
│   ├── db-migrate.mjs             Idempotent migration runner
│   ├── setup-resend-dns.sh        Adds Resend DNS records to the Route 53 zone
│   ├── setup-eventbridge-cron.sh  Provisions the AWS EventBridge cron trigger
│   ├── deploy.sh                  Deploy wrapper (opens the deployed URL on completion)
│   └── verify-gcp-services.mjs    Re-validates GCP productIds against the live catalog
│
├── public/
│   └── favicon.svg                Cloud icon with green status dot
│
├── vercel.json                    Rewrites, function config, cron schedules
├── vite.config.ts                 Injects __APP_VERSION__/__BUILD_DATE__ from package.json + build time; also emits dist/version.json (same build date) for useVersionCheck.ts
├── tailwind.config.ts
├── tsconfig.json
├── claude.md                      Original architecture handoff and data source research
│
├── docs/
│   ├── ENHANCEMENTS.md            Backlog of dashboard optimizations and improvements
│   ├── AWS-MIGRATION-ASSESSMENT.md  Assessment for a potential move off Vercel to AWS
│   ├── CUSTOM-DOMAIN-PLAN.md      Plan to move the app to a synepho.com subdomain
│   └── PROMPT-REFINEMENT-GUIDE.md  How the AI Insight prompt/pipeline works, how to refine it, and a plan for an admin UI to customize it live
```

---

## Local Development

**Prerequisites:** Node.js 20+, npm

```bash
# Install dependencies
npm install

# Start dev server (http://localhost:5173)
npm run dev

# Type-check + build
npm run build

# Lint
npm run lint

# Verify GCP's canonical service IDs still resolve against the live product catalog
npm run verify:gcp
```

The Azure proxy (`/api/status/azure`) and everything under **Alerts & Admin**
above are Vercel Functions. For full local testing (Azure data, sign-up,
manage, admin, cron), use the Vercel CLI instead of plain `npm run dev`:

```bash
vercel env pull .env.local   # first time only, or after env vars change
vercel dev --listen 3002     # any free port — 3000 is commonly reserved for a separate dev server
```

Plain `npm run dev` runs the Vite frontend only — Azure and everything
under `/api/*` will error or 404 since the function runtime isn't running.

Vercel BotID passes through as "human" automatically in local dev, so
`/api/subscribe` isn't blocked the way it is against real (non-browser)
traffic in production.

---

## Deployment

```bash
# Deploy to production (lint → build → deploy → open browser)
npm run deploy

# Deploy to preview URL (lint → build → deploy → open browser)
npm run deploy:preview
```

Both scripts run lint and build first, then open the deployed URL automatically in your browser on completion.

**First-time setup:**
```bash
vercel login   # authenticate
vercel link    # link this directory to the Vercel project
```

Vercel auto-detects the Vite framework and Node.js serverless functions in `/api`. No additional configuration required beyond `vercel.json`.

**Environment variables:** the dashboard itself needs none — all four
status data sources are public and unauthenticated. Alerts & Admin needs
the variables listed above; they're already provisioned on the Vercel
project (Production, Preview, and Development), so a fresh clone just
needs `vercel env pull .env.local` rather than sourcing new values.

**Cron:** `/api/cron/check-status` (every 5 min) is triggered by AWS
EventBridge, provisioned separately via `scripts/setup-eventbridge-cron.sh`
— it isn't part of `vercel deploy` and doesn't need re-running on every
deploy, only if the cron infrastructure itself needs to change (including
after a domain change — see **Known constraints** above).
`/api/cron/cleanup` (daily) uses Vercel's own native cron, which *is*
covered by `vercel.json` and needs no separate provisioning step.

---

## Refresh and Caching Behavior

| Behavior                    | Detail                                                          |
| ----------------------------- | ------------------------------------------------------------------ |
| Auto-refresh interval       | 60 seconds                                                      |
| Manual refresh cooldown     | 60 seconds (starts after fetch completes)                       |
| Client cache (localStorage) | 60s TTL — hydrated on page load, matches poll interval          |
| Azure CDN cache             | `s-maxage=300, stale-while-revalidate=60` on Vercel Function    |
| Alerts change-detection cadence | 5 minutes (AWS EventBridge → `/api/cron/check-status`)      |
| Offline behavior            | Auto-refresh pauses; banner shown; cached data displayed        |
| Stale data indicator        | Yellow banner if last fetch failed but cached data is available |
| Stale bundle (app itself) indicator | Client polls `dist/version.json` every 5 min (+ immediate on tab-focus) against the running bundle's build timestamp; banner + Reload button on mismatch — see `useVersionCheck.ts` |

---

## Observability

| Feature        | Status  | Notes                                          |
| --------------- | --------- | -------------------------------------------------- |
| Web Analytics  | ✅ Live | Vercel Web Analytics — enable in dashboard     |
| Speed Insights | ✅ Live | Core Web Vitals tracking — enable in dashboard |
| Function logs  | ✅ Live | `vercel logs <url> --follow` or Logs tab       |
| Notification log | ✅ Live (data only) | `notification_log` table records every send attempt; no dedicated admin UI reads it yet |

---

## Roadmap

### Completed

- React + Vite + TypeScript + Tailwind scaffold
- AWS, GCP, OCI live data via direct browser fetch
- Azure live data via Vercel serverless proxy (Atom feed → normalized JSON)
- Top-10 canonical service status per provider (all four)
- Azure per-service status derived from incident title keyword matching
- Active incident list with severity and recency sorting
- Recently resolved incidents shown with green styling (24h window)
- Auto-refresh + manual refresh with cooldown
- Offline detection + localStorage caching (60s TTL)
- Light/dark/system appearance modes, moved under a Settings menu
- Responsive mobile layout
- Provider order: AWS → Azure → OCI → GCP
- Dynamic browser tab title (shows active incident count)
- Favicon + Open Graph / Twitter card meta tags
- Vercel Web Analytics
- Vercel Speed Insights
- Azure function CDN caching (`s-maxage=300`)
- Page Visibility API — polling pauses when tab is hidden, resumes with immediate fetch on focus
- Stats summary strip (providers degraded, regions impacted, services impacted, active incidents)
- Services impacted count with `+` suffix when broad multi-service incidents are active
- Bell icon in header opens a real sign-up form (double opt-in email alerting — see [Alerts & Admin](#alerts--admin) for the full build)
- Footer disclaimer (data source attribution, non-affiliation notice) + short About sentence for SEO
- Mobile-optimised 1×4 stat strip with condensed tile layout
- Deployment scripts: `npm run deploy` and `npm run deploy:preview` (lint → build → deploy → open)
- Operational service status now shown in green (was gray)
- Equal-width provider cards (4×1fr grid — first card no longer wider during outages)
- Azure RSS parser fix — feed returns RSS format (`rss.channel.item`), not Atom (`feed.entry`); services and regions now extracted from structured `<category>` elements
- Active incidents shown as expandable rows in provider panels; clicking reveals affected services and latest update text
- AWS region rows normalized — removed canonical region ID (e.g. `me-central-1`) from header; display name only
- Date parsing hardened — Azure RFC 2822 dates normalized to ISO 8601 server-side; client formatters guard against `Invalid Date` with `isNaN` check
- GCP active incidents no longer silently dropped — `incidents.json` omits `end` entirely for ongoing incidents instead of setting it `null`; strict `!== null` check treated `undefined` as closed
- GCP incident detail link fixed — `uri` field is a relative path (`incidents/{id}`), not an absolute URL; now resolved against `status.cloud.google.com`
- Active incident cards show "Updated X ago" (latest update time) instead of the static original start date
- `ProviderGrid` no longer re-sorts by severity — renders the documented fixed order (AWS → Azure → OCI → GCP) on every refresh
- GCP region/service matrix now follows the same top-10-plus-"Multiple Services *" display pattern as AWS, matched by stable `productId` (verified against `status.cloud.google.com/products.json`) with title keyword as fallback
- `npm run verify:gcp` — re-validates the 10 hardcoded GCP `productId`s against the live product catalog on demand
- Custom domain — dashboard moved to `cloudstatus.synepho.com`, permanent redirect from the old `csp-status-hub.vercel.app` URL (see `docs/CUSTOM-DOMAIN-PLAN.md`)
- Azure region/service breakdown now matches AWS/GCP/OCI — grouped from parsed incident regions/services into a real region → service map, with a canonical top-10 list and "Multiple Services *" catch-all
- Azure "View timeline" link fixed — the feed's own `<link>` pointed at an internal backend hostname, not the public `azure.status.microsoft` domain, and wasn't incident-specific; `detailUrl` now always uses the canonical public domain
- AWS EventBridge cron target endpoint drift fixed — see **Known constraints** in Alerts & Admin
- OCI real per-incident feed (`incident-summary.rss`) wired in — region/service breakdown and the incident table now populate the same way AWS/GCP/Azure do, replacing the earlier `status.json`-only summary
- Alerts & Admin: sign-up, double opt-in confirmation, manage/unsubscribe, admin subscriber list with CSV export and manual actions, ad hoc test-email tool, Sign in with Vercel admin auth, AWS EventBridge 5-minute change detection, resolution notifications (fires when a previously-active incident disappears from a provider's feed, not just when new ones appear), Upstash Redis status-snapshot cache (replacing an earlier Postgres table that kept Neon compute from autosuspending) — full architecture in [Alerts & Admin](#alerts--admin)
- SEO: page `<h1>`, sitemap `lastmod`, `noindex` header on `/admin` and `/manage`, crawlable About text in the footer
- Incident Briefing Engine, Phase 1: per-incident content-hash trigger (new/content_changed/resolved) layered on `check-status.ts`'s existing diff, fire-and-forget `/api/analysis/run` calling AWS Bedrock via Vercel OIDC federation, `incident_analysis` Postgres table — see [Alerts & Admin](#alerts--admin)
- Incident Briefing Engine, Phase 2: public `/api/analysis/latest` read endpoint (originally `/api/analysis/history` with a version stepper; simplified 2026-08-29 to always show just the current version — see **Reading it back** below), lazy-fetched "AI Insight" panel on each incident card with a Technical/Executive toggle
- Incident Briefing Engine, Phase 3: `@react-pdf/renderer`-generated, Synepho-branded PDF export per brief version, uploaded to Vercel Blob with a 1-year immutable cache, "Download PDF" links on the dashboard
- Incident Briefing Engine, Phase 4 (final phase): outage/resolution emails link to a dashboard deep-link that auto-expands the right incident's AI Insight panel; admin run history, manual retry for failed rows, and live settings (debounce interval, per-provider kill switch) — see [Alerts & Admin](#alerts--admin)
- Incident Briefing Engine PDF polish (2026-08-29): fixed double-spaced body text (paragraph-block rendering instead of per-line blocks), removed a duplicate trailing disclaimer in the executive PDF, added a "Powered by Synepho" + site-URL line to the footer — see **PDF export (Phase 3)** in [Alerts & Admin](#alerts--admin)
- AI Insight panel simplified (2026-08-29): dashboard now shows only the single latest brief per incident instead of a multi-version stepper (`/api/analysis/latest` replaces `/api/analysis/history`) — see **Reading it back (Phase 2)** in [Alerts & Admin](#alerts--admin)
- About modal refreshed (2026-08-29): copy tightened to lead with the AI Insight feature; version bumped to 1.2.0 to reflect the Incident Briefing Engine work landed since the last bump
- Header logo now returns to the dashboard itself (2026-08-31): links to `cloudstatus.synepho.com` in the same tab instead of opening the personal site `synepho.com` in a new one — the footer's "Built by John Xanthopoulos" credit still links out to `synepho.com`
- AI Insight disclaimer reworded and now appended to both briefs (2026-08-31): no longer leads with DR/failover framing — states plainly that the brief is AI-generated guidance, the reader's environment may differ and need other steps, and not to assume automatic failover is configured. Previously appended only to the executive brief's closing line; now appended to both the technical and executive briefs (`api/_lib/analysisPrompt.ts`)
- Admin AI Run History: re-run enabled for any row, not just failed ones (2026-08-31): the row action menu (`RunHistoryPanel.tsx`) and `api/admin/analysis-admin.ts`'s `retry` action both dropped the `status='failed'` restriction, so a `complete` row can be forced to regenerate — e.g. to pick up a prompt change for an incident that's still active — without waiting for a natural `content_changed`/`resolved` trigger
- GCP `latestUpdate` fix — Description included, not just Summary (2026-09-01): GCP's Summary section is near-static boilerplate that repeats verbatim across every update for an incident, while the actual evolving narrative lives in Description; `extractGcpSummary()` was extracting Summary only, so both the incident card and the AI Insight content-change trigger (which hashes `latestUpdate`) went stale on real GCP incidents — see `CLAUDE.md`'s Known Constraints & Caveats table for the full writeup
- Stale-bundle detection + reload prompt (2026-09-01): a long-open tab can keep running the JS bundle it loaded with even while its 60s poll cycle keeps fetching fresh data, so a deploy's fix never reaches it until reloaded. `vite.config.ts` now emits `dist/version.json` from the same build timestamp baked into the bundle; the new `useVersionCheck()` hook (`src/hooks/useVersionCheck.ts`) polls it every 5 minutes and on tab-focus, and `App.tsx` shows a "new version available" banner with a Reload button on mismatch

### Pending (see docs/ENHANCEMENTS.md)

- Aggregate status indicator in the header
- localStorage cache schema versioning
- Vite manual chunk splitting for `fast-xml-parser`
- Keyboard accessibility (`aria-expanded`, `aria-controls`) on expandable panels
- Top-level React error boundary
- SMS alerts (deferred pending Twilio A2P 10DLC registration)
- Escalation notices and per-subscriber severity thresholds (optional widening — resolution notices are already built, see [Alerts & Admin](#alerts--admin))

---

\_Maintained by John Xanthopoulos
