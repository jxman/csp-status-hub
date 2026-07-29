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
│                    Promise.allSettled()                              │
│                    → DashboardStatus (unified schema)               │
│                    → localStorage cache (60s TTL)                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  UI Layout                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ StatusHeader: title · live indicator · refresh · theme      │   │
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

---

## Tech Stack

| Layer       | Technology                                      |
| ----------- | ----------------------------------------------- |
| Frontend    | React 18 + Vite 6                               |
| Language    | TypeScript 5.6                                  |
| Styling     | Tailwind CSS 3 (dark mode via `class` strategy) |
| XML Parsing | `fast-xml-parser` 5 (browser + serverless)      |
| Serverless  | Vercel Functions (Node.js, auto-detected)       |
| Deployment  | Vercel (Vite SPA + `/api` routes)               |
| Analytics   | Vercel Web Analytics + Speed Insights           |

---

## Data Sources

| Provider | Dashboard                          | Data URL                           | Format   | CORS       | Proxy               |
| -------- | ---------------------------------- | ---------------------------------- | -------- | ---------- | ------------------- |
| AWS      | https://status.aws.amazon.com/     | `.../rss/all.rss`                  | RSS/XML  | ✅ Direct  | None                |
| Azure    | https://azure.status.microsoft/    | `rssfeed.azure.status.microsoft/...` | RSS/XML  | ❌ Blocked | `/api/status/azure` |
| OCI      | https://ocistatus.oraclecloud.com/ | `.../api/v2/status.json`           | JSON     | ✅ Direct  | None                |
| GCP      | https://status.cloud.google.com/   | `.../incidents.json`               | JSON     | ✅ Direct  | None                |

**Coverage notes:**

- **AWS** — `all.rss` covers only incidents AWS publishes publicly (significant/widespread events). Minor single-service degradations appear only in per-service feeds.
- **Azure** — Public RSS feed covers only major widespread incidents. Affected services and regions are extracted from structured `<category>` elements (or title text as a fallback) and rolled up into a region × service breakdown, same as AWS/GCP/OCI — matched against a canonical top-10 service list by keyword, with anything else collapsed into a "Multiple Services *" row. Still bounded by whatever Microsoft's feed itself names; full authenticated-account granularity would require the Azure Service Health ARM API.

---

## Provider Order

Panels and data are always returned in this order: **AWS → Azure → OCI → GCP**

---

## Alerts & Admin

Opt-in email alerting: sign up (bell icon), confirm via email, get notified
the moment a provider you follow transitions from operational to something
else. Full design, decisions, and as-built notes (including a few real
gotchas hit along the way) live in **[docs/ALERTS-DESIGN.md](./docs/ALERTS-DESIGN.md)**
— this section is just the map.

| Route | Purpose |
| --- | --- |
| `/` (bell icon) | Sign up — name, email, provider checkboxes, invisible bot check |
| `/manage?token=...` | Edit providers or unsubscribe (link comes from your confirmation email) |
| `/admin` | Subscriber list, search/filter, CSV export, manual actions — gated behind Sign in with Vercel |

**Backend pieces beyond the dashboard itself:**

- **Neon Postgres** (Vercel Marketplace) — subscriber and status-snapshot data
- **Resend** — transactional + outage-notification email, sending from `alerts.synepho.com`
- **Vercel BotID** — invisible bot check on the sign-up form
- **Sign in with Vercel** — admin auth, restricted to a single hardcoded `ADMIN_EMAIL`
- **AWS EventBridge** (Rules + Connection + API Destination) — polls `/api/cron/check-status` every 5 minutes; Vercel's own Hobby-plan cron only allows once/day, so this fills that gap. Provisioned via `scripts/setup-eventbridge-cron.sh`
- **Vercel Firewall** — rate limiting on the sign-up endpoint

**Environment variables** (see `.env.local`, gitignored — pull with `vercel env pull`):
`DATABASE_URL`, `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN`, `APP_BASE_URL`, `CRON_SECRET`, `VERCEL_OAUTH_CLIENT_ID`, `VERCEL_OAUTH_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_EMAIL`.

**Database migrations** live in `scripts/db/*.sql`, applied via:
```bash
vercel env pull .env.local
set -a && source .env.local && set +a
node scripts/db-migrate.mjs
```

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
│   ├── admin/subscribers/
│   │   ├── index.ts               GET  — list/filter/CSV export + summary counts
│   │   └── [id].ts                PATCH/DELETE — resend/unsubscribe/delete
│   ├── cron/
│   │   ├── check-status.ts        Status diffing + notification dispatch (EventBridge + Vercel cron)
│   │   └── cleanup.ts             Daily retention purge (unconfirmed 7d, unsubscribed 90d)
│   └── _lib/
│       ├── types.ts               Re-exports shared types for API functions
│       ├── db.ts                  Neon client
│       ├── email.ts               Resend templates (confirm, update-confirm, welcome, outage)
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
│   │   ├── StatusHeader.tsx       Header: title, live dot, refresh, bell (subscribe), theme toggle
│   │   ├── ProviderGrid.tsx       4-column responsive grid
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
│   │   └── AdminPage.tsx          /admin — subscriber list, filters, CSV export, actions
│   ├── fetchers/
│   │   ├── awsFetcher.ts          RSS parse + GUID parsing + deduplication
│   │   ├── azureFetcher.ts        Calls /api/status/azure proxy, normalizes response
│   │   ├── gcpFetcher.ts          incidents.json → normalized schema
│   │   └── ociFetcher.ts          status.json → normalized schema
│   ├── hooks/
│   │   ├── useStatusPolling.ts    60s polling, cooldown, offline detection, 60s cache
│   │   └── useTheme.ts            Light/dark toggle, localStorage persistence
│   ├── types/
│   │   └── status.ts              Unified schema (StatusLevel, ProviderStatus, etc.)
│   └── utils/
│       ├── awsServices.ts         AWS top-10 canonical service list
│       ├── azureServices.ts       Azure top-10 canonical service list + keyword matchers
│       ├── gcpServices.ts         GCP top-10 canonical service list
│       ├── ociServices.ts         OCI top-10 canonical service list
│       ├── statusHelpers.ts       Status → color/label/dot mapping
│       └── formatters.ts          Relative time formatting
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
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── claude.md                      Original architecture handoff and data source research
│
├── docs/
│   ├── ENHANCEMENTS.md            Backlog of dashboard optimizations and improvements
│   ├── ALERTS-DESIGN.md           Full design/decisions/as-built notes for the alerts feature
│   ├── AWS-MIGRATION-ASSESSMENT.md  Assessment for a potential move off Vercel to AWS
│   └── CUSTOM-DOMAIN-PLAN.md      Plan to move the app to a synepho.com subdomain
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
deploy, only if the cron infrastructure itself needs to change.
`/api/cron/cleanup` (daily) uses Vercel's own native cron, which *is*
covered by `vercel.json` and needs no separate provisioning step.

---

## Refresh and Caching Behavior

| Behavior                    | Detail                                                          |
| --------------------------- | --------------------------------------------------------------- |
| Auto-refresh interval       | 60 seconds                                                      |
| Manual refresh cooldown     | 60 seconds (starts after fetch completes)                       |
| Client cache (localStorage) | 60s TTL — hydrated on page load, matches poll interval          |
| Azure CDN cache             | `s-maxage=300, stale-while-revalidate=60` on Vercel Function    |
| Offline behavior            | Auto-refresh pauses; banner shown; cached data displayed        |
| Stale data indicator        | Yellow banner if last fetch failed but cached data is available |

---

## Observability

| Feature        | Status  | Notes                                          |
| -------------- | ------- | ---------------------------------------------- |
| Web Analytics  | ✅ Live | Vercel Web Analytics — enable in dashboard     |
| Speed Insights | ✅ Live | Core Web Vitals tracking — enable in dashboard |
| Function logs  | ✅ Live | `vercel logs <url> --follow` or Logs tab       |

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
- Light/dark mode
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
- Bell icon in header opens a real sign-up form (double opt-in email alerting — see [Alerts & Admin](#alerts--admin) and `docs/ALERTS-DESIGN.md` for the full build)
- Footer disclaimer (data source attribution, non-affiliation notice)
- Mobile-optimised 1×4 stat strip with condensed tile layout
- Deployment scripts: `npm run deploy` and `npm run deploy:preview` (lint → build → deploy → open)
- Operational service status now shown in green (was gray)
- Equal-width provider cards (4×1fr grid — first card no longer wider during outages)
- Azure RSS parser fix — feed returns RSS format (`rss.channel.item`), not Atom (`feed.entry`); services and regions now extracted from structured `<category>` elements
- `IncidentTable` component: active incidents shown as expandable rows in provider panels (consistent with AWS region rows); clicking reveals affected services and latest update text
- AWS region rows normalized — removed canonical region ID (e.g. `me-central-1`) from header; display name only
- Date parsing hardened — Azure RFC 2822 dates normalized to ISO 8601 server-side; client formatters guard against `Invalid Date` with `isNaN` check
- GCP active incidents no longer silently dropped — `incidents.json` omits `end` entirely for ongoing incidents instead of setting it `null`; strict `!== null` check treated `undefined` as closed
- GCP incident detail link fixed — `uri` field is a relative path (`incidents/{id}`), not an absolute URL; now resolved against `status.cloud.google.com`
- Active incident cards show "Updated X ago" (latest update time) instead of the static original start date
- `ProviderGrid` no longer re-sorts by severity — renders the documented fixed order (AWS → Azure → OCI → GCP) on every refresh
- GCP region/service matrix now follows the same top-10-plus-"Multiple Services *" display pattern as AWS — previously every affected product outside the canonical list was listed individually because GCP service matching used hardcoded slugs that never matched real feed data
- GCP canonical top-10 now matches services by stable `productId` (verified against the authoritative `status.cloud.google.com/products.json` catalog), with title keyword as a fallback; replaced the non-existent "Cloud Networking" entry with "Virtual Private Cloud (VPC)"
- `npm run verify:gcp` — re-validates the 10 hardcoded GCP `productId`s against the live product catalog on demand
- Custom domain — dashboard moved to `cloudstatus.synepho.com`, permanent redirect from the old `csp-status-hub.vercel.app` URL (see `docs/CUSTOM-DOMAIN-PLAN.md`)
- Azure region/service breakdown now matches AWS/GCP/OCI — `azureFetcher.ts` groups each active incident's parsed regions/services into a real region → service map instead of always returning an empty region list; `RegionTable.tsx` gained `buildAzureServiceList()` (top-10 always shown, extras collapsed into "Multiple Services *"); the old ad hoc `IncidentTable` component this replaced was removed
- Azure "View timeline" link fixed — the feed's own `<link>` element pointed at Microsoft's internal backend hostname (e.g. `azurestatusprodeus.azurewebsites.net`) rather than the public `azure.status.microsoft` domain, and wasn't incident-specific anyway; `detailUrl` now always uses the canonical public domain
- Azure canonical service list: replaced `Monitor` with `Network Infrastructure`, matching what the feed's categories actually report
- AWS EventBridge cron target endpoint drift fixed — the custom-domain redirect (above) 308'd every EventBridge invocation of the old `.vercel.app` URL, silently failing status checks and alerts for days; `scripts/setup-eventbridge-cron.sh` now points at the current domain and self-heals endpoint drift on re-run instead of skipping

### Pending (see docs/ENHANCEMENTS.md)

- OCI per-service status (API returns it; fetcher currently uses overall status)
- Aggregate status indicator in the header
- localStorage cache schema versioning
- Vite manual chunk splitting for `fast-xml-parser`
- Keyboard accessibility (`aria-expanded`, `aria-controls`) on expandable panels
- Top-level React error boundary
- SMS alerts (Phase 6 of `docs/ALERTS-DESIGN.md` — deferred pending Twilio A2P 10DLC registration)
- Resolution/escalation notices and per-subscriber severity thresholds (optional widening, see `docs/ALERTS-DESIGN.md` Section 14.7)

---

\_Maintained by John Xanthopoulos
