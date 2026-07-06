# CSP Status Hub — Alert Subscription Feature: Design Document

**Status:** Phases 0–3 built, tested, and verified live (not yet deployed to production). Phase 4 in progress — cron cadence mechanism revised mid-phase (see Section 7).
**Author:** Claude Code (drafted for John Xanthopoulos)
**Date:** 2026-07-05
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

-- 003_provider_status_snapshot.sql
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
  - **Unsubscribe** → `GET /api/subscribe/unsubscribe?token=<manage_token>`,
    one click, sets `status = unsubscribed`. Implemented as **idempotent** (a
    second hit — e.g. an email-scanner prefetch — is a harmless no-op) rather
    than adding a confirm-click page, matching the original CAN-SPAM-driven
    one-step requirement.
- Provider-change emails after that point (from 4.1) do **not** re-send the
  manage/unsubscribe links — `manage_token` doesn't change on an update, so
  the subscriber's original welcome email still works.

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
  `provider_status_snapshot`. Per 14.7, a **notify-worthy change** is narrowly
  defined: `overall_status` transitions from `operational` to anything else.
  Escalation within an ongoing incident, incident updates, and eventual
  resolution are all recorded in the snapshot for bookkeeping but do **not**
  trigger anything in Phase 4 (there's nothing to trigger yet — Phase 4 only
  logs; Phase 5 wires actual dispatch to this same signal).
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

## 8. Notification Dispatch — As Built (Email); SMS Not Started

**Email — Resend** (14.2), confirmed working: domain `alerts.synepho.com`
verified via 3 DNS records added to the existing Route 53 zone (`synepho.com`,
zone ID `Z1YCOPGKIGNAB3`) using a small idempotent script,
`scripts/setup-resend-dns.sh`. `sendOutageNotificationEmail()` is the actual
outage-notification template — subject line names the provider and the
status it dropped to, body links the official status page plus the
subscriber's own manage/unsubscribe links (built from their `manage_token`).

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
- **Notification log view**: not built — depends on the `notification_log`
  table, which doesn't exist until Phase 5.

### 10. Admin Auth — The Real Mechanics (revised from 14.3's original assumption)

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
`SESSION_SECRET` env var, 30-day expiry, `timingSafeEqual` verification) —
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
    "resend": "^...",
    "botid": "^..."
  }
}
```

`twilio` is not yet installed — still Phase 6. Package names above are the
actual installed ones (`botid`, not `@vercel/botid` as originally guessed;
`@neondatabase/serverless`, not `@vercel/postgres`, per what the Neon
Marketplace integration guide actually specified).

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
| Database | Neon Postgres via Vercel Marketplace | Live — `neon-bistre-zebra` |
| Email | Resend | Live — domain `alerts.synepho.com` verified |
| SMS | Twilio | Not started (Phase 6) |
| Bot protection | Vercel BotID | Live |
| Admin auth | Sign in with Vercel + custom session cookie | Live |
| Cron (primary) | AWS EventBridge (Rules + Connection + API Destination) | Live — provisioned via `scripts/setup-eventbridge-cron.sh` |
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
| 14.6 | Unsubscribed-record retention | **Hard-delete after 90 days** | Not yet built (Phase 7) |
| 14.7 | Notification trigger (v1) | **Initial outage report only** | Implemented in Phase 4's diff logic |
| 14.8 | Cron interval | **5 minutes** | Mechanism changed — see 14.9 |
| 14.9 | Cron cadence mechanism | **AWS EventBridge Rules** (not Scheduler — Scheduler rejects API Destination ARNs, discovered by testing), HTTPS target via an API Destination + Connection, `Authorization: Bearer $CRON_SECRET` | Vercel Hobby caps native cron at once/day — a `*/5 * * * *` `vercel.json` entry fails at deploy time, not just reduced precision. Vercel's own daily cron kept as a free fallback |

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
and sign-out.

### Phase 4 — Server-side change detection — 🔄 In progress

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

### Phase 5 — Email notifications live — ✅ Complete

- `notification_log` table live
- `sendOutageNotificationEmail()` wired directly into `/api/cron/check-status`
  — no separate job/queue, dispatch happens in the same request that detects
  the transition
- Verified end-to-end: a subscriber following the affected provider was
  emailed (confirmed delivered) and logged; a subscriber following a
  different provider was correctly skipped; re-running the cron against an
  unchanged ongoing outage produced zero duplicate notifications

### Phase 6 — SMS — Not started (user deferred Twilio registration)

### Phase 7 — Polish — ✅ Complete

- Rate limiting on `/api/subscribe` via Vercel Firewall (verified live)
- `/api/cron/cleanup` — 7-day unconfirmed purge + 90-day unsubscribed purge
  (14.6), Hobby-native daily cron, verified against seeded stale rows
- Resolution notices / escalation notices / per-subscriber severity
  threshold (14.7's optional widening) — **not built**, left as explicitly
  optional future work per the original design; nothing here blocks it
  later since `provider_status_snapshot` already tracks what's needed

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

*Next step: test Phase 4 detection accuracy against real provider data,
then move to Phase 5 (actual notification dispatch).*
