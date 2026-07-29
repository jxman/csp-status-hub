# CSP Status Hub — Alert Subscription Feature: Design Document

**Status:** Phases 0–5 and 7 complete, deployed to production
(now `https://cloudstatus.synepho.com` — moved from `csp-status-hub.vercel.app`
on 2026-07-17, see `docs/CUSTOM-DOMAIN-PLAN.md`), and verified live end-to-end
including real test alerts. Only Phase 6 (SMS) remains, deferred by user
request. Several fixes and refinements have landed post-ship from direct
production use — see Sections 4.1, 5, 7.3, 7.5, 7.6, 8, and 9.1.
**Author:** Claude Code (drafted for John Xanthopoulos)
**Date:** 2026-07-07
**Depends on:** `claude.md` (base architecture), stays on Vercel (no platform migration planned)

---

## 1. Feature Summary

Add opt-in alerting so a subscriber gets notified (email and/or SMS) when a cloud
provider they care about changes status. Requirements from kickoff conversation:

- Sign-up form: name, email(s), optional SMS number, checkboxes for which providers
  to follow (AWS / Azure / GCP / OCI / "All")
- Bot protection ("are you human") on sign-up
- Double opt-in: new registrations **and** any update to an existing registration
  require confirmation before taking effect
- Self-service unsubscribe (no login required)
- Simple backend admin view to review subscribers and pull basic reports
- Stays on Vercel — no other hosting platform in scope for the *application*
  (Route 53 DNS was already AWS; EventBridge (Rules, not Scheduler — see
  Section 7.3) now joins it for a
  narrow scheduling gap — see Section 17 for why that doesn't change the
  "stays on Vercel" call)

This is a bigger architectural step than anything built so far: the app is
currently a static SPA with one stateless serverless function (Azure proxy) and
**no persistent storage**. Alerting requires state (who's subscribed to what),
a way to detect status *changes* server-side (not just serve current status to a
browser), and outbound email/SMS delivery.

---

## 2. Architecture — As Built

```text
                         ┌─────────────────────────┐
                         │   React SPA (existing)  │
                         │  + /manage, /admin       │
                         │    routes (path-based,   │
                         │    no router library)     │
                         └───────────┬─────────────┘
                                     │ POST/GET
                                     ▼
        ┌───────────────────────────────────────────────────────┐
        │              Vercel Serverless Functions                │
        │  /api/subscribe          — create/stage a subscription  │
        │  /api/subscribe/confirm  — confirm signup or an update   │
        │  /api/subscribe/manage   — view/update providers by token│
        │  /api/subscribe/unsubscribe — one-click opt-out          │
        │  /api/auth/authorize     — start Sign in with Vercel      │
        │  /api/auth/callback      — token exchange + session cookie│
        │  /api/auth/signout       — clear session cookie           │
        │  /api/admin/subscribers  — list/filter/CSV (session-gated)│
        │  /api/admin/subscribers/[id] — resend/unsub/delete        │
        │  /api/cron/check-status  — status diffing (Phase 4)       │
        └───────────┬───────────────────────┬─────────────────────┘
                    │                       │
                    ▼                       ▼
        ┌───────────────────────┐   ┌──────────────────────────┐
        │  Neon Postgres (Vercel │   │  Resend                    │
        │  Marketplace)          │   │  from alerts.synepho.com    │
        │  subscribers table      │   │  (DNS verified via          │
        │  provider_status_       │   │  Route 53 — see 17)         │
        │  snapshot table          │   └──────────────────────────┘
        └───────────────────────┘
                    ▲
                    │ diff against last snapshot
                    │
        ┌───────────────────────────────────────────────────────┐
        │  AWS EventBridge Rule — every 5 min (Section 7.3)         │
        │  → HTTPS POST to /api/cron/check-status with a Bearer     │
        │    token, via an EventBridge API Destination               │
        │  (Vercel's own daily cron stays wired as a redundant       │
        │   fallback — Hobby plan caps native cron at once/day)      │
        └─────────────────────────────────────────────────────────┘
```

The existing client-side polling (`useStatusPolling.ts`) for the dashboard itself
is untouched — that keeps serving the live UI. The cron job is a **separate,
independent** poller whose only job is change-detection for notifications.

**What changed from the original plan, and why**, is called out inline in each
section below rather than hidden — several real-world constraints surfaced
during implementation that the original design didn't anticipate (Vercel's
OAuth app creation flow, Hobby plan cron limits, BotID's actual config
mechanism). Section 14 remains the log of decisions; new ones are appended
rather than silently overwritten.

---

## 3. Data Model — As Built

Three migrations applied so far, in `scripts/db/`, run via `scripts/db-migrate.mjs`
(idempotent, safe to re-run):

```sql
-- 001_subscribers.sql
CREATE TABLE subscribers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  email             TEXT NOT NULL,
  phone             TEXT,
  providers         TEXT[] NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending_confirmation',
                    -- pending_confirmation | confirmed | unsubscribed
  email_verified_at TIMESTAMPTZ,
  sms_opt_in        BOOLEAN NOT NULL DEFAULT false,
  confirm_token     TEXT,
  confirm_token_expires_at TIMESTAMPTZ,
  manage_token      TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  unsubscribed_at   TIMESTAMPTZ,
  UNIQUE (email)
);
CREATE INDEX idx_subscribers_confirm_token ON subscribers (confirm_token)
  WHERE confirm_token IS NOT NULL;

-- 002_pending_providers.sql
ALTER TABLE subscribers ADD COLUMN pending_providers TEXT[];
-- Added once it became clear the 4.1 update flow needed somewhere to stage
-- an unconfirmed provider change without touching the live `providers` column.

-- 003_provider_status_snapshot.sql — SUPERSEDED 2026-07-29, see 7.7.
-- Table is left in place (unused) rather than dropped; the cron no longer
-- reads or writes it. Snapshot state now lives in Upstash Redis.
CREATE TABLE provider_status_snapshot (
  provider            TEXT PRIMARY KEY,
  overall_status      TEXT NOT NULL,
  active_incident_ids TEXT[] NOT NULL DEFAULT '{}',
  last_checked_at     TIMESTAMPTZ NOT NULL,
  raw_signature       TEXT NOT NULL
);

-- 004_notification_log.sql
CREATE TABLE notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID REFERENCES subscribers(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  channel       TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  success       BOOLEAN NOT NULL
);
```

One person, one row — a single subscriber record holds both email and (optional)
SMS, plus their provider selection. `pending_providers` holds a *staged* change
awaiting re-confirmation (see 4.1); it's `NULL` unless an already-confirmed
subscriber has a pending update in flight. "All" is stored as a literal
`{'all'}` sentinel rather than expanding to all four, so future providers get
included automatically.

---

## 4. Sign-Up Flow (Double Opt-In) — As Built

```text
User fills form → BotID check (invisible) → POST /api/subscribe
                                                    │
                        ┌───────────────────────────┼───────────────────────────┐
                        │ no existing row            │ status = pending          │ status = confirmed
                        │ → INSERT, pending           │ → reissue confirm_token    │ → stage pending_providers
                        │                             │                            │   (see 4.1), skip if unchanged
                        │ status = unsubscribed → reset as a fresh signup          │
                        └───────────────────────────┬───────────────────────────┘
                                                    ▼
                                    Send the appropriate email via Resend
                                    (confirmation vs. "confirm changes")
                                                    ▼
                              User clicks → GET /api/subscribe/confirm
                                                    ▼
                  ┌─────────────────────────────────┴─────────────────────────────────┐
                  │ row was pending_confirmation:                                        │
                  │   status → confirmed, email_verified_at = now(),                     │
                  │   generate a FRESH manage_token, send a separate "Welcome —          │
                  │   manage your subscription" email containing the manage/unsubscribe   │
                  │   links (see why in Section 5), redirect ?confirm=success             │
                  │                                                                        │
                  │ row was confirmed with pending_providers set:                          │
                  │   providers ← pending_providers, clear pending_providers,               │
                  │   redirect ?confirm=updated                                             │
                  └───────────────────────────────────────────────────────────────────────┘
```

**Deviation from the original plan, and why:** the original design put
manage/unsubscribe links directly in the confirmation email. That can't
actually work — `manage_token` doesn't exist yet when the confirmation email
is sent (it's generated *at* confirm time), and Section 5's own security
requirement ("`manage_token` ... only ever sent via email, never displayed on
screen or logged") rules out generating it earlier and passing it through a
redirect URL, which would put a bearer credential in browser history. The
fix: a **separate welcome email**, sent immediately after confirmation
succeeds, carries those links instead. No schema change, no security
compromise, one extra `sendWelcomeEmail()` call.

- No confirmation email → no alerts. Unconfirmed-row cleanup is still Phase 7,
  not yet built.
- SMS consent checkbox doesn't exist yet — SMS collection is deferred to
  Phase 6 along with dispatch, per the original phase plan.

### 4.1 Updates to an existing subscription — As Built

Resubmitting the public sign-up form with an email that's already in the table
branches on current status:

- **`pending_confirmation`** → reissue `confirm_token`, resend the same
  confirmation email. No new row, no duplicate.
- **`confirmed`** → compare the new provider selection against the current
  one. If identical, do nothing (avoids a pointless email). If different,
  stage it in `pending_providers` + a fresh `confirm_token`, and send a
  **"Confirm changes to your subscription"** email — the existing
  subscription (old providers) stays active and unaffected until that's
  clicked. This form is unauthenticated (anyone can type anyone else's
  email), so a change here must always be re-verified.
- **`unsubscribed`** → treated as a brand-new signup: row resets to
  `pending_confirmation` with the new name/providers, `unsubscribed_at`
  cleared, a normal confirmation email sent (not the "confirm changes"
  variant).

All three branches return the exact same generic API response
(`"Check your email to confirm your subscription."`) regardless of which
branch fired, or whether the email exists at all — anti-enumeration, per 12.3.

**Fixed after initial ship:** the first version of this logic only ever
touched `name` in the `unsubscribed` (fresh-signup) branch — resubmitting
with a new name while `pending_confirmation` or `confirmed` silently kept
the old name, since those branches only checked for provider differences.
Name isn't security-sensitive the way providers/email are, so there's no
reason it should wait on anything: it now updates immediately in all three
branches, independent of whatever's happening with providers in that same
request (tested: name-only change → immediate update, no email; name +
provider change together → name updates immediately while the provider
change still stages and requires confirmation).

---

## 5. Manage / Unsubscribe Flow — As Built

- **Welcome email** (sent once, right after initial confirmation — see Section
  4's deviation note) contains:
  - **Manage my subscription** → `/manage?token=<manage_token>` — a real SPA
    page (`src/components/ManagePage.tsx`) that fetches the current
    subscription via `GET /api/subscribe/manage?token=...` and lets the
    provider checkboxes be edited. Saving hits `POST /api/subscribe/manage`
    and **takes effect immediately, no re-confirmation** — the token itself
    already proves ownership (only the real inbox owner has this link), unlike
    the public form in 4.1.
  - **Unsubscribe** → originally a direct one-click `GET
    /api/subscribe/unsubscribe?token=...` link straight from the email, per
    CAN-SPAM's "one step" requirement. **Changed after user feedback**: the
    email's "Unsubscribe" link now points to
    `/manage?token=...&action=unsubscribe` instead — landing on the dashboard
    site first, with a confirmation panel (`ManagePage.tsx`,
    `confirmingUnsubscribe` state) offering "Cancel", "Yes, unsubscribe" (the
    real link to the GET endpoint), and a reminder that unchecking providers
    and hitting Save is an alternative to leaving entirely. `?action=
    unsubscribe` auto-expands that panel on load so it's still effectively
    one click past the email, while removing the risk of an automated
    email-scanner prefetch silently unsubscribing someone by hitting a raw
    mutating link. The actual `/api/subscribe/unsubscribe` endpoint is
    unchanged (still GET, still idempotent) — it's just no longer linked to
    directly from outside the app. A layout bug surfaced during testing:
    the confirm panel initially *replaced* the Save-changes button instead
    of sitting alongside it, hiding the exact button the panel's own copy
    told you to use — fixed so both are always visible together.
    **UX fix (2026-07-29):** editing any provider checkbox — "All providers"
    or an individual one — while the confirm panel is open now dismisses it
    (`toggleProvider()` and the "All providers" `onChange` both call
    `setConfirmingUnsubscribe(false)`). The panel's own copy tells the user
    to uncheck providers and hit Save instead of unsubscribing; leaving the
    "Unsubscribe from all alerts?" warning on screen while they're actively
    doing exactly that read as contradictory. Verified via Playwright against
    a mocked `/api/subscribe/manage` response: confirm panel visible, click a
    provider checkbox, panel gone — checked from both the "all providers" and
    individual-provider-selected starting states.
- Provider-change emails after that point (from 4.1) do **not** re-send the
  manage/unsubscribe links — `manage_token` doesn't change on an update, so
  the subscriber's original welcome email still works.
- **Cancel + post-save/cancel navigation (2026-07-29):** the page previously
  had no way to leave without either saving or unsubscribing. Added a
  **Cancel** button next to Save changes (`handleCancel()`), and both exit
  paths now return to the home dashboard (`/`) — but not identically:
  - **Cancel** navigates immediately (`window.location.href = '/'`) — nothing
    changed, so there's nothing to confirm.
  - **Save** deliberately does *not* redirect instantly: it shows the
    existing inline "Saved." confirmation first, then navigates after a
    1.5s pause (`setTimeout` in `handleSave()`). An instant redirect on
    success was considered and rejected — the page would disappear before
    the user had a chance to actually see "Saved.", which reads as "did
    that work?" rather than confirming it did.
  - Verified via Playwright (mocked `/api/subscribe/manage`): Cancel → `/`
    immediately; Save → still on `/manage`, "Saved." visible at +200ms →
    `/` by +1.9s, with the POST body carrying the correct token/providers.

`manage_token` is generated fresh every time a row transitions from
`pending_confirmation` → `confirmed` (including a post-unsubscribe resignup),
invalidating any old link as a matter of routine hygiene.

---

## 6. Bot / Human Verification — As Built

**Decision: Vercel BotID** (14.4), confirmed correct. One implementation
surprise worth recording: **there is no dashboard toggle for BotID** on a Vite
project. It's pure configuration —

- `botid` npm package installed
- A literal, copy-paste `rewrites`/`headers` block added to `vercel.json` for
  "other frameworks" (the UUID-looking paths in that block are fixed
  boilerplate from Vercel's own docs, not project-specific values — confirmed
  by fetching the docs page directly, since guessing wrong here would have
  silently broken the challenge/proxy routing)
- `initBotId()` client-side and `checkBotId()` server-side, wired into the
  `/api/subscribe` POST handler specifically

We initially assumed this needed a Firewall dashboard toggle (it doesn't) and
briefly looked at the wrong dashboard section (**Bot Management** — a
different, coarser Vercel Firewall feature that challenges non-browser
traffic site-wide) before realizing BotID is fully self-contained in code.
Bot Management's `Bot Protection`/`AI Bots` toggles are left **off** — not
part of this design, and not needed since BotID handles the one route that
actually matters.

---

## 7. Server-Side Status Polling for Change Detection

This is the piece that doesn't exist in the dashboard today and is the actual
trigger for alerts. Right now, status fetching only happens **in the visiting
browser** (`src/fetchers/*`) — there's no server-side process watching for
changes when nobody has the dashboard open.

### 7.1 Fetcher refactor — smaller than expected

The original plan assumed all four fetchers needed to move to a shared
isomorphic module. On inspection, `awsFetcher.ts`, `gcpFetcher.ts`, and
`ociFetcher.ts` already used nothing but global `fetch` and `fast-xml-parser`
— both server-safe — so `/api/cron/check-status` imports them **directly**
from `src/fetchers/`, same pattern already used by `api/_lib/types.ts`. No
duplication, no rewrite.

Only `azureFetcher.ts` was actually browser-only (it called our own
`/api/status/azure` proxy via a relative URL and referenced `location.hostname`
for a dev-mode error message). Its core fetch-and-parse logic was extracted
out of `api/status/azure.ts`'s handler into `api/_lib/azureFetcher.ts`, which
both the existing client-facing proxy endpoint and the new cron job now call
directly — no HTTP round-trip to our own deployment from within the cron
function.

### 7.2 Change detection logic

- `/api/cron/check-status` fetches all four providers' status server-side,
  using the same normalization schema as `src/types/status.ts`.
- For each provider, it compares the fresh fetch against
  `provider_status_snapshot`. **Revised post-launch (2026-07-16, see 14.7a):**
  a notify-worthy change is now any **new incident ID** appearing in
  `active_incident_ids` that wasn't in the stored row, regardless of
  `overall_status`. The original 14.7 definition (`overall_status` transitions
  from `operational` to anything else) shipped in Phase 4 but was found in
  production to silently swallow alerts: a still-open, unrelated AWS regional
  outage (ME-CENTRAL-1/ME-SOUTH-1) kept `overall_status` pinned at
  non-`operational` for months, so a brand-new, unrelated CloudFront incident
  never tripped the `operational →` edge and no alert fired. Diffing incident
  IDs catches new incidents independent of what else is already ongoing. The
  very first check ever recorded for a provider (no existing row) is treated
  as a baseline snapshot only, not a notification trigger, so bootstrapping
  against an already-live incident doesn't fire a notification storm.
  Escalation within an ongoing incident and incident updates are still
  recorded in the snapshot for bookkeeping but do **not** trigger anything —
  only new incidents starting and existing incidents resolving alert (14.7's
  originally-deferred widening, built 2026-07-17, see 14.7b).
- **Resolution detection (14.7b):** the mirror image of the new-incident
  diff — any ID present in the stored row but missing from the fresh fetch is
  treated as resolved, and triggers `sendResolutionNotificationEmail`
  (`incident_resolved` in `notification_log`). This works whether a provider
  publishes an explicit resolved/closed update (AWS's `[RESOLVED]` items,
  GCP's `end`/`AVAILABLE` status) or just silently drops the entry once
  cleared (confirmed live: Azure's feed currently has zero entries, active or
  resolved — an incident's absence is the only signal). **`ociFetcher.ts`
  itself has no incident-level data to diff** — it only reads the page-level
  `status.json` summary (bare `{indicator, description}`, no incidents
  array; the `regionHealthReports` schema in `CLAUDE.md` Section 3.4 was
  never actually implemented against it). Since ID diffing needs *something*
  to diff, it now synthesizes one constant id (`oci-current-incident`)
  whenever `overallStatus !== 'operational'`. This makes OCI participate
  correctly in both directions — new alert when it goes bad, resolved alert
  when it clears — with one known tradeoff: two genuinely distinct OCI
  incidents that never pass back through "operational" in between are
  treated as a single continuous incident (no second new-incident alert, no
  resolved alert until the second one clears too) — this was the case until
  14.10 (Section 7.4, implemented 2026-07-17) wired in a real per-incident
  feed (`api/v2/incident-summary.rss`). The synthetic id described above is
  kept as a safety net for when the two sources disagree, but is no longer
  the primary mechanism — see Section 7.4 for the current design.
- On a fetch failure for one provider, that provider's snapshot row is **left
  untouched** rather than overwritten with `unknown` — a transient network
  blip shouldn't manufacture a false transition on the next successful check.
- `raw_signature` (sha256 of `overallStatus + sorted active incident ids`) is
  stored per provider for future cheap-diffing use, even though v1's actual
  trigger condition only needs `overall_status`.

### 7.3 Cron cadence mechanism — revised mid-implementation

The original plan (14.8) was a native `vercel.json` `crons` entry running
every 5 minutes. **This doesn't work on the Hobby plan**: Vercel caps Hobby
cron jobs at once per day, and a `*/5 * * * *` expression fails at *deploy
time*, not just at reduced precision. This wasn't caught during design — it
surfaced when actually wiring the cron entry.

Three options were on the table: upgrade to Vercel Pro ($20/mo) for native
per-minute cron, drop to once-daily detection on Hobby (defeats the purpose —
next-day outage detection isn't "alerting"), or trigger the endpoint
externally on a tighter cadence. **Decision: AWS EventBridge**
(14.9) — free, and this project already has AWS credentials and a Route 53
zone in play for DNS, so it isn't a new relationship, just a new use of an
existing one.

**Mechanics — corrected after a live failure.** The original plan (and this
doc's prior revision) assumed EventBridge **Scheduler** (`aws scheduler
create-schedule`) could target an API Destination ARN directly. It can't —
`create-schedule` rejects an API Destination ARN as `Target.Arn` with
`ValidationException: Provided Arn is not in correct format`, discovered only
by actually running it. The correct, documented mechanism is the **older,
more mature classic EventBridge Rules** service instead (`aws events
put-rule` / `put-targets`), whose `HttpParameters` target field explicitly
names "EventBridge ApiDestination" support. Rules also tag natively, which
Scheduler doesn't (Scheduler can only tag *schedule groups*, not individual
schedules — one more reason Rules ended up being the simpler choice).

Provisioned via `scripts/setup-eventbridge-cron.sh` (idempotent, re-runnable,
mirrors `setup-resend-dns.sh`'s style) — everything shares the
`csp-status-hub` name prefix as the single place to look:

1. **`aws events create-connection`** — `AuthorizationType=API_KEY`,
   `ApiKeyAuthParameters={ApiKeyName: "Authorization", ApiKeyValue: "Bearer <CRON_SECRET>"}`.
   Stores the header EventBridge attaches to every invocation.
2. **`aws events create-api-destination`** — `InvocationEndpoint=https://csp-status-hub.vercel.app/api/cron/check-status`,
   `HttpMethod=GET`, referencing the connection above.
3. **An IAM role** (`csp-status-hub-eventbridge-role`) trusted by
   `events.amazonaws.com`, with an inline policy granting
   `events:InvokeApiDestination` scoped to that one API Destination ARN.
4. **`aws events put-rule`** — `--schedule-expression "rate(5 minutes)"`,
   tagged directly at creation (10 standard tags, `SubService=eventbridge-rule`).
5. **`aws events put-targets`** — attaches the API Destination as the rule's
   target, referencing the IAM role from step 3.

The script also cleans up the two orphaned resources (`csp-status-hub`
Scheduler group, `csp-status-hub-scheduler-role`) left behind by the failed
first attempt.

`/api/cron/check-status` already checks `Authorization: Bearer $CRON_SECRET`
(a `CRON_SECRET` env var is provisioned) — the same check protects it whether
the caller is Vercel's own cron invoker (which sends this header
automatically when `CRON_SECRET` is set) or EventBridge (via the Connection
above).

**Vercel's native cron stays wired too**, just at the Hobby-safe daily
cadence (`0 0 * * *` in `vercel.json`) — a free, redundant fallback in case
the EventBridge side ever misfires, at no extra cost since it's within Hobby
limits.

See Section 17 for the broader question this raised: given AWS is now in the
loop for scheduling, should more of the backend move there too?

---

### 7.4 OCI real incident feed — implemented (14.10)

`ociFetcher.ts` today only reads `api/v2/status.json` — a bare
`{indicator, description}` page summary with no incident-level data, which
is why `regions` is always `[]` and 14.7b needed a synthetic single incident
id. A real per-incident feed exists and was inspected live 2026-07-17:
`api/v2/incident-summary.rss`.

**Confirmed shape**, live:

- **One RSS `<item>` per incident**, not one per update like AWS. The
  `<guid>` is a permanent, stable OCID (`ocid1.oraclecloudincident.oc1...`)
  that Oracle updates in place as the incident progresses — pubDate and the
  description both grow with each new update, same guid throughout. This
  means **no dedup/grouping pass is needed**, unlike `awsFetcher.ts`'s
  GUID-base + latest-pubDate grouping.
- **`<title>`**: `{service-or-category} | {region display name} |
  {reference}`, e.g. `"Virtual Cloud Network (VCN) | US East (Ashburn) |
  210f910e"`. Reliably splits on `" | "`. Some incidents use broad labels
  (`"Networking"`, `"Multiple Services"`, `"Multiple Regions"`) — the same
  fallback shape AWS (`multipleservices`) and GCP already have.
- **`<description>`**: HTML, one `<p>` block per update, newest first. Each
  block opens `<strong>{StatusWord}</strong> - {narrative}` where
  `StatusWord` is `Investigating` / `Identified` / `Monitoring` / `Resolved`
  — maps directly onto the existing `Incident['status']` union in
  `status.ts`, no title-guessing heuristic needed (unlike Azure's
  `parseStatus`).
- **`<pubDate>`**: last-update time (matches the newest embedded block).
- **`<link>`**: real detail URL (`.../#/incidents/{same-ocid}`).

**Design:**

1. Keep `status.json` as the sole source of `overallStatus`/`coverageNote`
   — simple, low-risk, and it's literally what feeds OCI's own status
   banner. Not being replaced.
2. Add the RSS fetch. Parse each `<item>` directly into an `Incident` (no
   dedup pass needed, per above):
   - `status`: map the newest (`first`) `<strong>` word directly to
     `investigating/identified/monitoring/resolved/unknown`.
   - severity/color: keyword-scan the newest update's narrative
     (`outage`/`disruption`/`unavailable` → high/outage;
     `degrad`/`impact`/`latency`/`connectivity` → medium/degraded), same
     philosophy as AWS's `inferStatus()`.
   - `latestUpdate`: HTML-strip just the newest `<p>` block's narrative
     sentence, dropping the boilerplate Customer Impact/Start Time/
     Reference Number trailer — same "one clean blurb" normalization
     already applied to GCP's `extractGcpSummary()`.
   - `affectedRegions`/`affectedServices`: the title's two segments.
3. Active vs. recently-resolved windowing: same 24h pattern as AWS/GCP —
   status ≠ resolved is active; resolved within 24h is shown once, then
   drops off.
4. Build `RegionStatus[]`/`ServiceStatus[]` from these. This also fixes a
   `ProviderPanel.tsx` display gap found alongside this design: once OCI
   produces a real incident, `hasActiveIncidents` routes to the incident
   table instead of the decorative flat `OCI_CRITICAL_SERVICES` list, so
   that list currently only ever renders while OCI is fully operational
   (i.e., only when it's uninteresting). Real region data fixes this the
   same way AWS/GCP already work.
5. **Safety net kept, not removed**: whether the RSS reflects a
   freshly-opened incident in real time (vs. only once further along)
   couldn't be verified — no live OCI incident existed to test against. So
   the 14.7b synthetic `oci-current-incident` id stays, but only fires if
   `status.json` reports non-operational **and** the RSS parse found zero
   active incidents that tick — a safety net for the two sources
   disagreeing or the RSS lagging, not the primary path.
6. **`regionId` uses the RSS's raw display name** (e.g. `"US East
   (Ashburn)"`) rather than a hand-built display-name → canonical-slug
   table (like AWS's `us-ashburn-1`) — avoids a mapping table that would
   need to be guessed/verified per region and kept in sync as Oracle adds
   regions.
7. No changes needed to `check-status.ts`, `email.ts`, or the DB schema —
   the id/title diffing built for 14.7b is already fully generic over
   whatever a fetcher returns.

**Companion UI change:** `RegionTable.tsx` gained a `buildOciServiceList()`
alongside the existing `buildServiceList()` (AWS) / `buildGcpServiceList()`
(GCP) — matches OCI's free-text service names against
`OCI_CRITICAL_SERVICES` by keyword (that file gained a `keywords: string[]`
per entry, GCP-style, since OCI's title text isn't a clean enum like AWS's
slugs), with a "Multiple Services *" catch-all row for anything else — same
pattern GCP's `RegionTable.tsx` already establishes. This also fixes the
display gap noted when this was designed: `OCI_CRITICAL_SERVICES` previously
only ever rendered while OCI was fully operational: now that real region
data exists, the incident table and region table both populate correctly
during an actual OCI incident.

**Verification, implementation day:** no live OCI incident existed to test
against (same as design time), so the parse pipeline was verified two ways:
(1) the real feed, live — 0 active/recently-resolved incidents, matching
`status.json`'s `operational`; (2) a synthetic RSS built from real historical
description HTML (an actual "Investigating" update block from a past
incident, with `pubDate` moved to now) fed through a mocked `fetch`, which
correctly produced `status: 'investigating'`, the right region
(`"Saudi Arabia West (Jeddah)"` → `Middle East`), the right service slug,
and a clean stripped `latestUpdate` with the boilerplate trailer removed. A
separate mocked run (non-operational `status.json`, empty RSS) confirmed the
14.7b safety net still fires correctly when the two sources disagree.

### 7.5 Azure region/service breakdown — implemented (14.11)

Same underlying gap as 7.4's OCI fix, for a different reason: `azureFetcher.ts`
always returned `regions: []`, so an active Azure incident replaced the whole
provider panel with `IncidentTable.tsx` — a bespoke component that only listed
that one incident's own narrow `affectedServices` list. The canonical top-10
critical services (`azureServices.ts`) and their "still operational" status
disappeared entirely during any Azure outage, and anything the incident named
outside that top-10 had no consistent presentation — found 2026-07-23 while
reviewing why a live Azure incident's dashboard view looked thinner than AWS's
for the same kind of event.

**Design:** unlike OCI (7.4), there was no undiscovered richer feed to switch
to — Azure's Atom/RSS feed already provides everything used here (`<category>`
elements, or title-text fallback, both already parsed by `parseAffected()`).
The gap was purely that this data was never rolled up into `RegionStatus[]`:

1. `azureFetcher.ts` now groups each active incident's parsed
   `affectedRegions` × `affectedServices` into a `Map<regionName, Map<serviceId,
   ServiceStatus>>`, then converts that into `RegionStatus[]` — the same shape
   AWS/GCP/OCI already build.
2. Incidents with no parseable region (title/categories didn't match the known
   `AZURE_REGIONS` set — genuinely possible, same category of gap as AWS's
   region-less global/edge GUIDs, see `claude.md` Section 9) fall into a
   `Global` bucket rather than silently dropping their service impact.
   `regionId` for that bucket is lowercased to `'global'`, matching the
   existing AWS convention (`claude.md` — CloudFront/Route 53), so it picks up
   the same "+" treatment in the dashboard's regions-impacted stat
   (`StatsBanner` in `App.tsx`) automatically, with no changes needed there.
3. Real region names (e.g. `"West US"`) keep their display-name string as
   `regionId`, same reasoning as OCI's 14.10 (no canonical slug exists to map
   to, and building one would need per-region verification and upkeep).
4. `RegionTable.tsx` gained `buildAzureServiceList()` — identical pattern to
   `buildGcpServiceList()`/`buildOciServiceList()`: the top-10 from
   `AZURE_CRITICAL_SERVICES` always render (defaulting to Operational),
   anything else reported gets collapsed into a single "Multiple Services *"
   row.
5. `ProviderPanel.tsx`'s Azure-specific branch (a stopgap added earlier the
   same day, before this region-based fix, to at least show the top-10 list
   flat alongside the incident) and `IncidentTable.tsx` itself were both
   removed as dead code — once Azure populates `regions` like every other
   provider, `hasRegions` routes it through the same `<RegionTable />` branch
   automatically, no Azure-specific branching left in `ProviderPanel.tsx`.

**Companion fix, same day:** `entryToIncident()`'s `detailUrl` was trusting
the feed's own `<link>` element for the "View timeline" link. Live inspection
showed that link is a raw backend App Service hostname (e.g.
`azurestatusprodeus.azurewebsites.net`) — an internal implementation detail
sitting behind Microsoft's branded `azure.status.microsoft` domain/CDN, not a
documented public endpoint — and the exact same generic root URL on every
entry regardless of incident, so it wasn't even incident-specific. `detailUrl`
now always uses the canonical `azure.status.microsoft` domain instead.

**Verification:** confirmed against the live Azure feed both before and after
Microsoft enriched the same incident with more structured `<category>` data
mid-investigation — first pass (`affectedServices: ["Network Infrastructure"]`
only) correctly produced all 10 critical services Operational plus a single
Degraded "Multiple Services *" row (since "Network Infrastructure" didn't
match any top-10 keyword at the time); after Microsoft added 12 named
categories to the same incident, re-running produced the expected mix of
Operational/Degraded rows across the top-10 with no "Multiple Services *" row
needed, grouped correctly under a single "West US" region. Also swapped
`Monitor` for `Network Infrastructure` in `AZURE_CRITICAL_SERVICES` — matches
what the feed's categories actually report for connectivity/infra incidents;
`Monitor` rarely if ever appears as an affected category in practice.

### 7.6 EventBridge target endpoint drift after the custom-domain migration (2026-07-23)

Discovered while investigating the same missing-Azure-alert report that led to
7.5. AWS CloudWatch showed `Invocations` exactly equal to `FailedInvocations`
on the `csp-status-hub-check-status` EventBridge rule for every 5-minute tick
in the checked window — every single invocation had been failing, meaning
`check-status.ts` hadn't actually run on schedule at all, Azure incident or
not.

**Root cause:** the EventBridge API Destination's `InvocationEndpoint` (set up
in 7.3) was still `https://csp-status-hub.vercel.app/api/cron/check-status`.
The custom-domain migration (`docs/CUSTOM-DOMAIN-PLAN.md`, 2026-07-17) added a
permanent redirect from that exact host to `cloudstatus.synepho.com` — correct
and necessary for browsers and bookmarks, but EventBridge API Destinations
don't follow HTTP redirects, so every invocation got a 308 back and counted it
as a failed call. Confirmed by curling the API Destination's literal
configured URL directly (308, no body) versus the new domain (200, real JSON)
with the same `Authorization: Bearer $CRON_SECRET` header both times.

**Why this wasn't caught by the domain migration's own Step 9 checklist:**
that checklist's cron item only says "next scheduled cron runs complete
without error in Vercel's cron logs" — true and checkable, but it only covers
Vercel's own native daily cron (`vercel.json`), which was never touched and
kept working. EventBridge is a separate piece of infrastructure with its own
hardcoded target, entirely outside `vercel.json` and outside `APP_BASE_URL` —
nothing in the domain migration plan's checklist or Section 3 ("every
absolute URL the app builds is driven by `APP_BASE_URL`") accounted for it,
because the EventBridge endpoint isn't something the *app* builds at runtime;
it's a value baked into AWS resource config and into
`scripts/setup-eventbridge-cron.sh`, both outside the app's deploy.

**Fix:**
1. `aws events update-api-destination` on the live `csp-status-hub-check-status`
   API Destination, pointing `InvocationEndpoint` at
   `https://cloudstatus.synepho.com/api/cron/check-status`.
2. `scripts/setup-eventbridge-cron.sh`'s `TARGET_ENDPOINT` constant updated to
   match, and its "already exists, skipping" branch for the API Destination
   step now compares the live endpoint against `TARGET_ENDPOINT` and calls
   `update-api-destination` if they've drifted, instead of unconditionally
   skipping — so a future domain change plus a routine re-run of this script
   self-heals instead of silently continuing to point at a dead URL.
3. Verified via CloudWatch: zero `FailedInvocations` across the first four
   real 5-minute ticks after the fix, versus 100% failure before it.

**Side effect worth recording:** confirming the theory involved manually
curling the real (fixed) endpoint with the live `CRON_SECRET`. Because that's
the same code path the real cron uses, it detected the still-active Azure
incident as genuinely new and sent live outage emails to both real confirmed
subscribers as an unplanned side effect of verification, not a deliberate,
approved action — worth remembering for future debugging of any endpoint that
both diffs state *and* dispatches notifications on a detected change: it is
not a safe read-only healthcheck to invoke directly.

**Lesson for future domain/URL changes:** any change to the app's public
domain must also check for infrastructure with a *hardcoded* target URL
living outside the app's own deploy and outside `APP_BASE_URL` — currently
just the EventBridge API Destination (`scripts/setup-eventbridge-cron.sh`),
but the same class of risk would apply to any future webhook registration,
external monitor, or third-party integration configured with a literal
callback URL.

**Follow-up (2026-07-29):** the same self-heal pattern extended to the
rule's `Description` field — `setup-eventbridge-cron.sh`'s rule-creation
step now diffs the live `aws events describe-rule` description against the
script's `RULE_DESCRIPTION` constant and calls `put-rule` to update it if
they've drifted, instead of unconditionally skipping when the rule already
exists (previously only the API Destination endpoint self-healed this way,
not the rule's own metadata). `AdminPage.tsx` also gained a direct
"EventBridge →" console link under its AWS ops group, alongside the
existing Resend/domains links, so the rule can be checked without hunting
through the AWS console by hand.

### 7.7 Neon compute-hour exhaustion — snapshot state moved to Upstash Redis (2026-07-29)

Neon's Free plan (`neon-bistre-zebra`) hit its 100 CU-hr/month compute
allowance (102.06/100 used) partway through the billing cycle that started
Jul 2, 2026.

**Root cause:** every `check-status` tick — every 5 minutes, 24/7, via the
EventBridge cron from 7.3 — did a `SELECT` against `provider_status_snapshot`
for all four providers, whether or not anything had changed, just to diff
state. Neon's Free plan autosuspend is fixed at 5 minutes and can't be
shortened or disabled (only paid plans allow tuning it). Since the cron
interval equals the suspend window, the compute's idle timer kept getting
reset right as it was about to hit zero, so it never actually scaled to zero
— effectively running 24/7 at 0.25 CU (~6 CU-hrs/day, well over the monthly
allowance).

**Fix:** `provider_status_snapshot` (Section 3) is retired in favor of
Upstash Redis, installed via Vercel Marketplace
(`vercel integration add upstash/upstash-kv`) — `api/_lib/redis.ts` exports
a `Redis.fromEnv()` client (works against the Marketplace-provisioned
`KV_REST_API_URL`/`KV_REST_API_TOKEN` vars — `@upstash/redis`'s `fromEnv()`
falls back to those Vercel KV names automatically) plus a `ProviderSnapshot`
type and `snapshotKey(provider)` helper. `api/cron/check-status.ts` now does
`redis.get`/`redis.set` per provider instead of the old `SELECT`/`UPSERT`.

This specifically targets the mismatch that caused the overage: Redis here
is billed by request count (Upstash free tier: 500K commands/month), not
compute-uptime, so a workload that's cheap-but-constant — exactly this
polling pattern — no longer burns a metered resource just by staying alive.
At the current 5-minute cadence this uses roughly 69K commands/month, ~14%
of the free tier.

`subscribers` and `notification_log` **stay on Neon** — deliberately not
migrated. That data has real relational shape (foreign key from
`notification_log.subscriber_id`, `email` uniqueness, `manage_token`
lookups) and, more importantly, is only touched when an incident actually
starts or resolves (inside `notifySubscribers()`), which is rare — on the
order of a few times a week, not every 5 minutes. With the snapshot diff off
Postgres entirely, Neon compute now only wakes for those genuine events and
should scale to zero the rest of the time, keeping it comfortably inside the
Free plan even without changing the cron cadence.

`provider_status_snapshot` (and its `005_incident_titles.sql` follow-up) are
left in place in Neon rather than dropped — nothing reads or writes them
anymore, kept only as a historical record of the prior schema.

---

## 8. Notification Dispatch — As Built (Email); SMS Not Started

**Email — Resend** (14.2), confirmed working: domain `alerts.synepho.com`
verified via 3 DNS records added to the existing Route 53 zone (`synepho.com`,
zone ID `Z1YCOPGKIGNAB3`) using a small idempotent script,
`scripts/setup-resend-dns.sh`. `sendOutageNotificationEmail()` is the actual
outage-notification template — subject line names the provider and the
status it dropped to, body links the subscriber's own manage/unsubscribe
links (built from their `manage_token`).

**Changed after user feedback:** the primary link originally went straight
to the vendor's official status page (`sourceUrl`). It now points back to
the CSP Status Hub dashboard (`APP_BASE_URL`) instead — the user wanted
subscribers to land on the dashboard first, since each provider panel there
already links out to that same official status page (`ProviderPanel.tsx`),
so nothing was lost, and subscribers see the full picture (all four
providers, not just the one that alerted) before clicking further. The
unsubscribe link change is covered in Section 5.

Dispatch is wired directly into `/api/cron/check-status`'s existing
notify-worthy check (Section 7.2) — no separate job, no queue: when a
provider transitions, the same request that detected it queries
`subscribers WHERE status = 'confirmed' AND (provider = ANY(providers) OR
'all' = ANY(providers))` and emails each one in parallel
(`Promise.all`), logging every attempt (success or failure) to
`notification_log`. A per-subscriber send failure is caught and logged as
`success = false` rather than aborting the batch or the whole cron run.

**Deduplication needed no extra guard.** Because `notifyWorthy` is only ever
true on the specific `operational → non-operational` edge, a second cron run
while the outage continues naturally computes `notifyWorthy = false` (the
snapshot's `overall_status` is no longer `operational`) — verified live by
running the cron twice in a row against a real triggered outage and
confirming `notification_log` stayed at exactly one row.

**SMS — Twilio**, still deferred to Phase 6 per the original plan (A2P 10DLC
registration lead time). Not started; user opted to skip for now.

---

## 9. Admin Reporting — As Built

- **Auth**: Sign in with Vercel (OAuth, PKCE) — see Section 10 for the
  specific mechanics and the real gotchas hit getting there.
- **List/search/filter**: `GET /api/admin/subscribers` supports `status`,
  `provider`, and `q` (name/email substring) query params, filtered in
  application code rather than dynamic SQL (dataset is expected to stay in
  the dozens–hundreds, per 13, so this trades a little raw efficiency for
  much simpler, injection-proof code).
- **Summary counts**: total, confirmed, pending, unsubscribed, and a
  per-provider breakdown (counting `confirmed` subscribers only) — returned
  alongside the filtered list in the same response.
- **CSV export**: same endpoint, `?format=csv`, respects whatever filters are
  active.
- **Manual actions**: `PATCH /api/admin/subscribers/[id]` with
  `{action: 'resend_confirmation' | 'force_unsubscribe'}`, and
  `DELETE /api/admin/subscribers/[id]` for a hard delete. All gated behind the
  same session check as the list endpoint.
- **Notification log view**: not built. The `notification_log` table exists
  now (Phase 5), but there's no dedicated admin UI reading from it yet.
- **Manual refresh**: a "Refresh" button re-runs the same list query on
  demand (e.g. after a signup/unsubscribe happened elsewhere while the page
  was already open) without changing a filter or reloading the browser.

### 9.1 Real bug: bracket-syntax dynamic routes aren't auto-wired outside Next.js

`api/admin/subscribers/[id].ts` handles Resend/Unsubscribe/Delete, and was
**silently unreachable in production** for a while — every request to
`/api/admin/subscribers/<id>` fell through to the SPA's `index.html` instead
of hitting the function (confirmed via the `content-disposition:
inline; filename="index.html"` response header, not an error of any kind,
which is what made it easy to miss). Root cause, confirmed against Vercel's
own docs (their Gatsby example shows the identical fix): **bracket dynamic
API routes are a Next.js framework-adapter convention, not a general Vercel
Functions behavior** — a Vite project needs an explicit `vercel.json`
rewrite mapping the URL pattern to the literal bracket filename:

```json
{ "source": "/api/admin/subscribers/:id", "destination": "/api/admin/subscribers/[id]" }
```

This had been latent since Phase 3 — the handler logic itself was verified
correct via local testing, but the *routing* to reach it in production was
never actually exercised until the user clicked Unsubscribe in the live
`/admin` UI and got a generic "Action failed." Diagnosed by minting a valid
admin session cookie directly (using the known `SESSION_SECRET`) and
reproducing the exact request with `curl`, without needing browser access —
worth remembering as a technique for any future "logic looks right but the
button doesn't work" report on an authenticated route.

## 10. Admin Auth — The Real Mechanics (revised from 14.3's original assumption)

The original plan assumed "Sign in with Vercel" would be a straightforward
drop-in. Two real gaps surfaced:

1. **`vercel oauth-apps register` (CLI) does not expose a client secret.**
   The token exchange endpoint (`POST https://api.vercel.com/login/oauth/token`)
   requires `client_secret` as a mandatory parameter — there's no
   PKCE-only/public-client mode, contrary to an initial assumption. The
   secret is only obtainable by managing the *same* app object through the
   dashboard: **Team Settings → Apps → [app] → Authentication tab → Generate**.
   The CLI-registered app and the dashboard-manageable app turned out to be
   the same underlying object — the CLI just doesn't surface secret
   generation, callback URL configuration, or permission scopes. All three
   had to be set from the dashboard before login worked.
2. **No Vercel-side scoping to "your team" exists by default.** Any Vercel
   user could authorize the app and receive a valid `id_token` unless the
   application itself checks *who* it is. So the actual security boundary is
   ours, not Vercel's: after exchanging the code, the callback route decodes
   the `id_token`, and checks its `email` claim against a hardcoded
   `ADMIN_EMAIL` env var before issuing any session. Anyone else who
   completes the OAuth flow gets bounced with `?error=forbidden`.

Given that check is where the real security lives, `offline_access` /
refresh tokens turned out to be unnecessary complexity — the app only needs
the `id_token` once, at login, to establish identity. So instead of
persisting Vercel's own access/refresh tokens, `/api/auth/callback` mints its
**own** HMAC-signed session cookie (`api/_lib/session.ts`, signed with a
`SESSION_SECRET` env var, 7-day expiry (shortened from an initial 30 days
2026-07-17, since the account is single-admin and passkey-protected on the
Vercel side — a shorter cookie window is pure upside with no real
downside), `timingSafeEqual` verification) —
fully decoupled from Vercel's 1-hour access-token lifetime, and requiring
only `openid`, `email`, and `profile` scopes on the Vercel App (no
`offline_access`, no Vercel API read permissions at all, since nothing here
ever calls the Vercel REST API on the user's behalf).

Verified live end-to-end: full OAuth round trip, session issuance, gated
`/admin` access, CSV export, and sign-out all confirmed working against a
real Vercel login.

---

## 11. New API Surface — As Built

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/subscribe` | POST | BotID | Create/stage a subscription (handles new signup, resend, 4.1 update-staging, and post-unsubscribe reset) |
| `/api/subscribe/confirm` | GET | `confirm_token` in query | Finalize a signup or an update; generates `manage_token` and sends the welcome email on first confirmation |
| `/api/subscribe/manage` | GET/POST | `manage_token` in query | View/edit providers — immediate effect, no re-confirmation |
| `/api/subscribe/unsubscribe` | GET | `manage_token` in query | One-click, idempotent opt-out |
| `/api/auth/authorize` | GET | — | Starts Sign in with Vercel (PKCE + state/nonce cookies) |
| `/api/auth/callback` | GET | — | Token exchange, email-allowlist check, issues session cookie |
| `/api/auth/signout` | POST | — | Clears the session cookie |
| `/api/admin/subscribers` | GET | Session cookie | List/search/filter/CSV export + summary counts |
| `/api/admin/subscribers/[id]` | PATCH/DELETE | Session cookie | Resend confirmation, force-unsubscribe, hard delete |
| `/api/cron/check-status` | GET | `Bearer $CRON_SECRET` | Status diffing — triggered by EventBridge (primary) and Vercel's daily cron (fallback) |

---

## 12. Dependencies — As Installed

```json
{
  "dependencies": {
    "@neondatabase/serverless": "^...",
    "@upstash/redis": "^...",
    "resend": "^...",
    "botid": "^..."
  }
}
```

`twilio` is not yet installed — still Phase 6. Package names above are the
actual installed ones (`botid`, not `@vercel/botid` as originally guessed;
`@neondatabase/serverless`, not `@vercel/postgres`, per what the Neon
Marketplace integration guide actually specified). `@upstash/redis` added
2026-07-29 for the `provider_status_snapshot` migration — see 7.7.

---

## 13. Compliance & Abuse Considerations

CAN-SPAM, TCPA, and data-minimization notes unchanged from original design
(12.1, 12.2, 12.4). Rate limiting (12.3) is now built:

- **`/api/subscribe`** is rate-limited via a Vercel Firewall custom rule (5
  requests / 60s per IP, `deny` on breach) — CLI-manageable on the Hobby
  plan (`vercel firewall rules add` / `publish`), no application code
  needed. Verified live: a 7-request burst against production got denied
  partway through (`x-vercel-mitigated: deny` response header confirms the
  Firewall itself is blocking, not app code).
- **Retention purges** (`/api/cron/cleanup`, daily, Hobby-native — no
  EventBridge needed since once/day fits natively): deletes
  `pending_confirmation` rows older than 7 days, and `unsubscribed` rows
  older than 90 days (14.6). Verified against seeded stale rows — exactly
  the eligible rows were removed, active subscribers untouched.

---

## 14. Infra/Cost Summary — Current State

| Piece | Provider | Status |
| --- | --- | --- |
| Database | Neon Postgres via Vercel Marketplace | Live — `neon-bistre-zebra`. `subscribers`/`notification_log` only; see 7.7 |
| Status snapshot cache | Upstash Redis via Vercel Marketplace | Live — `upstash-kv-orange-ball`. Added 2026-07-29 (7.7) to stop `check-status`'s every-5-min diff query from keeping Neon compute from autosuspending |
| Email | Resend | Live — domain `alerts.synepho.com` verified |
| SMS | Twilio | Not started (Phase 6) |
| Bot protection | Vercel BotID | Live |
| Admin auth | Sign in with Vercel + custom session cookie | Live |
| Cron (primary) | AWS EventBridge (Rules + Connection + API Destination) | Live — provisioned via `scripts/setup-eventbridge-cron.sh`. Target endpoint is a literal value, **not** driven by `APP_BASE_URL` — re-run the script (self-heals drift) after any future domain change; see 14.12 |
| Cron (fallback) | Vercel Cron, daily (`check-status` + `cleanup`) | Configured in `vercel.json` |
| Rate limiting | Vercel Firewall custom rule | Live — `/api/subscribe`, 5 req/60s/IP |
| DNS | AWS Route 53 (`synepho.com` zone) | Pre-existing, now also hosting Resend's verification records |

Everything above is free-tier. See Section 17 for whether EventBridge's
presence here should push more services toward AWS.

---

## 15. Decisions Log

| # | Decision | Decided | Notes |
| --- | --- | --- | --- |
| 14.1 | Database | **Neon Postgres** (Vercel Marketplace) | Confirmed working |
| 14.2 | Email provider | **Resend** | Confirmed working, domain verified |
| 14.3 | Admin auth | **Sign in with Vercel** OAuth | Real mechanics turned out more involved — see Section 10 |
| 14.4 | Bot verification | **Vercel BotID** | Confirmed — pure config, no dashboard toggle exists (Section 6) |
| 14.5 | Config format | **Keep `vercel.json`** | Unchanged |
| 14.6 | Unsubscribed-record retention | **Hard-delete after 90 days** | Built in Phase 7 (`/api/cron/cleanup`) |
| 14.7 | Notification trigger (v1) | **Initial outage report only** | Implemented in Phase 4's diff logic; revised — see 14.7a |
| 14.7a | Notification trigger (revised) | **New incident ID, not `operational →` transition** | A live, months-long unrelated AWS regional outage kept `overall_status` stuck non-`operational` and silently suppressed alerts for a later, unrelated CloudFront incident (found in production 2026-07-16). Trigger now diffs `active_incident_ids` against the stored snapshot instead of gating on `overall_status`. See Section 7.2 |
| 14.7b | Resolution notifications | **Alert when an incident ID disappears from the active set** | Built 2026-07-17, closing 14.7's originally-deferred "resolution notices" scope. Works for all four providers uniformly — explicit resolved markers (AWS, GCP) and silent removal (Azure, OCI's synthesized id) both surface as "ID no longer active." `ociFetcher.ts` still only reads the page-level `status.json` summary (no per-incident id in that endpoint), so it synthesizes a stable id (`oci-current-incident`) — see 14.10 for a real incident feed found on the side that a future pass could wire in instead. See Section 7.2 |
| 14.8 | Cron interval | **5 minutes** | Mechanism changed — see 14.9 |
| 14.9 | Cron cadence mechanism | **AWS EventBridge Rules** (not Scheduler — Scheduler rejects API Destination ARNs, discovered by testing), HTTPS target via an API Destination + Connection, `Authorization: Bearer $CRON_SECRET` | Vercel Hobby caps native cron at once/day — a `*/5 * * * *` `vercel.json` entry fails at deploy time, not just reduced precision. Vercel's own daily cron kept as a free fallback |
| 14.10 | OCI real incident feed | **Implemented 2026-07-17** | See Section 7.4 for the full design and verification notes. `incident-summary.rss` is one persistent `<item>` per incident (stable OCID guid, updated in place — unlike AWS's one-item-per-update), so no dedup pass is needed. `status.json` stays as the `overallStatus`/`coverageNote` source; the RSS is purely additive for incident/region/service detail. The 14.7b synthetic `oci-current-incident` id is kept as a safety net (only synthesized if `status.json` disagrees with the RSS finding zero active incidents that tick), since real-time-ness of the RSS on a freshly-opened incident still couldn't be verified live (no live OCI incident existed at implementation time either — tested against a synthetic "Investigating" item instead, see Section 7.4). `regionId` uses the RSS's raw display name (e.g. `"US East (Ashburn)"`) rather than a hand-built canonical-slug table. Companion change: `RegionTable.tsx` gained `buildOciServiceList()`, `ociServices.ts` gained `keywords` per entry, mirroring GCP's pattern |
| 14.11 | Azure region/service breakdown | **Implemented 2026-07-23** | See Section 7.5. `azureFetcher.ts` now groups active incidents' parsed `affectedRegions` × `affectedServices` into a real `RegionStatus[]`, replacing the always-empty `regions: []` and the ad hoc `IncidentTable.tsx` component that gap required (now deleted). `RegionTable.tsx` gained `buildAzureServiceList()`, matching GCP/OCI's builders. Region-less incidents bucket into `regionId: 'global'`, matching AWS's edge-service convention. Companion fixes same day: `detailUrl` no longer trusts the feed's own `<link>` (points at an internal `azurestatusprodeus.azurewebsites.net`-style backend host, not the public domain, and isn't incident-specific); `AZURE_CRITICAL_SERVICES` swapped `Monitor` for `Network Infrastructure` |
| 14.12 | EventBridge target endpoint drift | **Fixed 2026-07-23** | See Section 7.6. The 2026-07-17 custom-domain cutover (`docs/CUSTOM-DOMAIN-PLAN.md`) redirects the old `.vercel.app` URL, but EventBridge's API Destination `InvocationEndpoint` (14.9) is a literal value outside `APP_BASE_URL`'s reach and was never updated — every 5-minute cron invocation 308'd and silently failed from cutover until discovery. Fixed live via `aws events update-api-destination`; `scripts/setup-eventbridge-cron.sh` now reconciles endpoint drift on re-run instead of skipping when the resource already exists |

---

## 16. Implementation Phases — Status

### Phase 0 — Infra provisioning — ✅ Complete

Neon, Resend (with DNS verification), BotID, Sign in with Vercel app all
provisioned. Twilio A2P registration explicitly deferred by user request —
revisit before Phase 6.

### Phase 1 — Sign-up + double opt-in confirmation — ✅ Complete

Built and verified end-to-end with real email delivery.

### Phase 2 — Manage & unsubscribe — ✅ Complete

Built and verified end-to-end, including the 4.1 update flow and
resubscribe-after-unsubscribe reset.

### Phase 3 — Admin view — ✅ Complete

Built and verified live against a real Vercel login, including CSV export
and sign-out. Two fixes landed after initial ship, both against real
production use rather than caught in testing: the bracket-dynamic-route
bug that broke Resend/Unsubscribe/Delete (Section 9.1), and a manual
Refresh button added on request.

### Phase 4 — Server-side change detection — ✅ Complete

- ✅ Azure fetch logic extracted to `api/_lib/azureFetcher.ts`; aws/gcp/oci
  fetchers reused directly, no refactor needed
- ✅ `provider_status_snapshot` table live
- ✅ `/api/cron/check-status` implemented and type-checked
- ✅ `vercel.json` updated (Hobby-safe daily fallback schedule)
- ✅ AWS EventBridge setup (Connection, API Destination, IAM role, Rule,
  Target) — provisioned via `scripts/setup-eventbridge-cron.sh`, corrected
  mid-flight from Scheduler to Rules after a live ValidationException
- ✅ End-to-end detection accuracy verified against a real live AWS outage

**Phases 0–4 deployed to production** (`https://csp-status-hub.vercel.app`).
Two bugs only surfaced at that deploy, not in local `vercel dev` testing, and
are fixed: `/manage`/`/admin` 404'd (missing SPA catch-all rewrite — local
dev was more lenient than production static hosting) and a `vercel.json`
`functions` glob overlap (`api/**/*.ts` + `api/cron/*.ts`) that broke `vercel
dev` entirely, simplified to one pattern.

**Third bug, found 2026-07-16 against a real live outage:** a real AWS
CloudFront incident rendered with region "unknown" in the dashboard (its
GUID has no region segment — see `CLAUDE.md` Section 9), and no alert email
went out for it. Root cause was two-fold: `parseGuid()`'s fallback mislabeled
global/edge-service GUIDs, and the 14.7 notify-worthy definition was gated on
an `operational →` transition that a separate, still-open regional outage
(ME-CENTRAL-1/ME-SOUTH-1) had permanently blocked for months. Both fixed and
deployed same-day — see 14.7a and Section 7.2. The already-recorded
CloudFront incident ID was also manually cleared from that day's
`provider_status_snapshot` row so the fixed logic would treat it as new and
send the (late) alert rather than staying silent on it forever.

**Fourth bug, found 2026-07-23:** a live Azure incident produced no alert
email at all, and investigation found every single EventBridge invocation of
`/api/cron/check-status` had been failing silently — `Invocations` equalled
`FailedInvocations` on every 5-minute tick for at least the prior 6 hours (and
almost certainly since the 2026-07-17 domain cutover in
`docs/CUSTOM-DOMAIN-PLAN.md`). Root cause: the EventBridge API Destination's
`InvocationEndpoint` was still the old `csp-status-hub.vercel.app` URL, which
`vercel.json`'s redirect rule now 308s to `cloudstatus.synepho.com` —
EventBridge doesn't follow redirects, so it counted every 308 as a failed
invocation. This endpoint is **not** driven by `APP_BASE_URL` — it's a
separate literal value baked into the live AWS resource and into
`scripts/setup-eventbridge-cron.sh`'s `TARGET_ENDPOINT`, so the domain
cutover's Step 6 (`APP_BASE_URL` update) had no effect on it and nothing
about the failure was visible from the app side (the request never reached
`check-status.ts`, so there was nothing to log). Fixed by updating the live
API Destination's endpoint and making the setup script reconcile drift on
re-run instead of skipping when the resource already exists — see Section
7.6 for the full writeup and the general lesson for future domain changes.

### Phase 5 — Email notifications live — ✅ Complete

- `notification_log` table live
- `sendOutageNotificationEmail()` wired directly into `/api/cron/check-status`
  — no separate job/queue, dispatch happens in the same request that detects
  the transition
- Verified end-to-end: a subscriber following the affected provider was
  emailed (confirmed delivered) and logged; a subscriber following a
  different provider was correctly skipped; re-running the cron against an
  unchanged ongoing outage produced zero duplicate notifications

**Three refinements after initial ship:** the primary link now points to
the dashboard instead of straight to the vendor (Section 8) and the
"Unsubscribe" link now lands on a confirmation panel instead of
unsubscribing on click (Section 5), both from direct user feedback on the
actual test emails; and `sendResolutionNotificationEmail()` was added
2026-07-17 alongside the 14.7b resolution-detection logic (Section 7.2) —
a separate template/subject line for "one incident resolved, others still
open" vs. "fully back to normal."

### Phase 6 — SMS — Not started (user deferred Twilio registration)

### Phase 7 — Polish — ✅ Complete

- Rate limiting on `/api/subscribe` via Vercel Firewall (verified live)
- `/api/cron/cleanup` — 7-day unconfirmed purge + 90-day unsubscribed purge
  (14.6), Hobby-native daily cron, verified against seeded stale rows
- Resolution notices — **built 2026-07-17** (14.7b, Section 7.2). Escalation
  notices and per-subscriber severity threshold remain **not built**, left as
  explicitly optional future work; nothing here blocks them later since
  `provider_status_snapshot` already tracks what's needed

---

## 17. AWS vs. Vercel-Native Backend Services — Assessment

**The question:** now that AWS EventBridge is filling a gap Vercel Hobby
can't (sub-daily cron), does it make sense to move more of the backend
natively to AWS — Neon → RDS/Aurora, Resend → raw SES, Vercel Functions →
Lambda — rather than keeping today's mix?

**Recommendation: keep the current hybrid. Don't let EventBridge become a
wedge for a broader migration.** Reasoning:

### Why EventBridge is a different *kind* of AWS usage than the others would be

EventBridge's role here is a timer that pokes a URL. It doesn't run
any of this app's logic, doesn't hold any of its state, and doesn't require
the app to know AWS exists beyond one outbound-facing secret header. Route 53
is the same shape: DNS is infrastructure-glue, not application logic. Both
are things Vercel simply doesn't do (or doesn't do on Hobby), so reaching for
AWS there fills an actual gap rather than duplicating something that already
works.

Database and email are categorically different — they're **stateful,
core-data services**, and the Marketplace integrations you already have are
specifically shaped for how this app runs:

- **Neon's serverless HTTP driver** (`@neondatabase/serverless`) was built
  for exactly this deployment model — no connection pooling problem, no VPC,
  works natively from a Vercel Function's short-lived execution. RDS/Aurora
  would need either a VPC-networked Postgres (Vercel Functions aren't inside
  your VPC, so this means public accessibility + security groups, or a
  Vercel↔AWS network bridge) or an RDS Proxy in front of it to handle
  serverless connection churn — real new infrastructure for a database that's
  currently a `neon()` import and an env var.
- **Resend already *is* built on SES** — literally: the DNS records this
  project added point to `feedback-smtp.us-east-1.amazonses.com` and
  `include:amazonses.com` for SPF. Switching to raw SES directly would mean
  losing Resend's simpler API and dashboard, manually building bounce/
  complaint webhook handling that Resend already provides, and starting over
  in **SES's sandbox mode** (200 emails/day, verified recipients only) until
  a production-access request is approved by AWS — real friction with zero
  functional upside, since you'd end up talking to the same underlying
  infrastructure either way.
- **Vercel Functions → Lambda** would mean re-platforming every `api/*.ts`
  handler (different request/response shape, different deployment pipeline,
  losing the zero-config Vite+Vercel integration this whole project is built
  around) for a feature (cron) that AWS can already serve standalone without
  touching compute at all.

### When this calculus would flip

If `csp-status-hub` itself ever moves off Vercel — you mentioned wanting to
eventually host it under a `synepho.com` subdomain on AWS, matching your
`synepho-s3cf-site` project's S3+CloudFront pattern — **that's** the point
where re-evaluating Neon vs. RDS and Resend vs. SES actually makes sense,
because at that point the app is *already* inside AWS's network boundary and
the VPC/IAM friction mostly disappears. Doing it now, while the app still
lives on Vercel, buys nothing but two more moving parts and a cross-cloud
network hop on every database query.

**Bottom line:** treat AWS as the right tool for infrastructure-glue
(DNS, scheduling) that Vercel's free tier doesn't cover, and treat the
Vercel Marketplace services as the right tool for stateful core data,
for as long as the app itself stays on Vercel. Revisit this specific
question — not before — if/when the hosting platform itself changes.

---

## 18. What This Doc Deliberately Doesn't Decide Yet

- Exact visual design of the sign-up form / admin UI (functional but
  unstyled beyond matching existing CSS variables — a polish pass, not
  blocking)
- Whether admin reporting ever needs anything beyond CSV export (e.g., charts)
- Multi-admin support — current design assumes a single hardcoded `ADMIN_EMAIL`

---

*Next step: Phase 6 (SMS via Twilio) whenever A2P 10DLC registration is
started and cleared, or Phase 7's optional widening (resolution/escalation
notices, per-subscriber severity threshold) if that becomes wanted sooner.
Everything else in the original phase plan is live.*
