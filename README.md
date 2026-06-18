# Cloud Status Hub

Real-time operational status dashboard for AWS, Azure, OCI, and GCP in a single unified view. Built for Marsh internal leadership and cloud engineering staff.

Auto-refreshes every 60 seconds. Shows active incidents, per-service health, and links through to official vendor status pages.

> **Status:** Live on Vercel — [csp-status-hub.vercel.app](https://csp-status-hub.vercel.app)

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
                          └─→ azurestatuscdn.azureedge.net/en-us/status/feed/
                                (Atom/XML → parsed → normalized JSON)

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
| Azure    | https://azure.status.microsoft/    | `azurestatuscdn.azureedge.net/...` | RSS/XML  | ❌ Blocked | `/api/status/azure` |
| OCI      | https://ocistatus.oraclecloud.com/ | `.../api/v2/status.json`           | JSON     | ✅ Direct  | None                |
| GCP      | https://status.cloud.google.com/   | `.../incidents.json`               | JSON     | ✅ Direct  | None                |

**Coverage notes:**

- **AWS** — `all.rss` covers only incidents AWS publishes publicly (significant/widespread events). Minor single-service degradations appear only in per-service feeds.
- **Azure** — Public RSS feed covers only major widespread incidents. Affected services and regions are extracted from structured `<category>` elements in the feed. Per-service status is derived by keyword-matching incident titles against a canonical service list. Full per-region granularity requires the authenticated Azure Service Health ARM API.

---

## Provider Order

Panels and data are always returned in this order: **AWS → Azure → OCI → GCP**

---

## Project Structure

```
csp-status-hub/
├── api/                           Vercel serverless functions
│   ├── status/
│   │   └── azure.ts               Azure Atom feed proxy (fetch, parse, normalize)
│   └── _lib/
│       └── types.ts               Re-exports shared types for API functions
│
├── src/
│   ├── App.tsx                    Root layout, dynamic title, Analytics, SpeedInsights
│   ├── main.tsx                   React entry point
│   ├── components/
│   │   ├── StatusHeader.tsx       Header: title, live dot, refresh, bell (subscribe), theme toggle
│   │   ├── ProviderGrid.tsx       4-column responsive grid
│   │   ├── ProviderPanel.tsx      Per-provider expandable card + service list
│   │   ├── RegionTable.tsx        Region → top-10 service status rows (AWS, GCP)
│   │   ├── IncidentTable.tsx      Incident rows with expand/collapse (Azure, no-region providers)
│   │   ├── FlatServiceList.tsx    Flat service list with per-service status support
│   │   ├── IncidentList.tsx       Active + recently resolved incidents, sorted by recency
│   │   ├── IncidentCard.tsx       Per-incident detail row with severity and link
│   │   ├── StatusBadge.tsx        Color-coded status pill
│   │   ├── ServiceRow.tsx         Single service row in region view
│   │   └── ErrorState.tsx         Per-provider fetch failure fallback
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
├── public/
│   └── favicon.svg                Cloud icon with green status dot
│
├── vercel.json                    Rewrite rules + function config
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── ENHANCEMENTS.md                Backlog of optimizations and improvements
└── CLAUDE.md                      Architecture decisions and data source research
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
```

The Azure proxy (`/api/status/azure`) is a Vercel Function. For full local testing including Azure data, use the Vercel CLI:

```bash
vercel dev
```

Plain `npm run dev` runs the Vite frontend only — Azure will show an error state since `/api/status/azure` is unavailable without the function runtime.

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

**Environment variables:** None required — all data sources are public and unauthenticated.

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
- Bell icon in header for subscribe to alerts (coming soon modal)
- "Coming soon" modal for alert subscriptions
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

### Pending (see ENHANCEMENTS.md)

- OCI per-service status (API returns it; fetcher currently uses overall status)
- Aggregate status indicator in the header
- localStorage cache schema versioning
- Vite manual chunk splitting for `fast-xml-parser`
- Keyboard accessibility (`aria-expanded`, `aria-controls`) on expandable panels
- Top-level React error boundary

---

\_Maintained by John Xanthopoulos
