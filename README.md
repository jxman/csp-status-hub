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

| Layer        | Technology                                      |
| ------------ | ----------------------------------------------- |
| Frontend     | React 18 + Vite 6                               |
| Language     | TypeScript 5.6                                  |
| Styling      | Tailwind CSS 3 (dark mode via `class` strategy) |
| XML Parsing  | `fast-xml-parser` 5 (browser + serverless)      |
| Serverless   | Vercel Functions (Node.js, auto-detected)       |
| Deployment   | Vercel (Vite SPA + `/api` routes)               |
| Analytics    | Vercel Web Analytics + Speed Insights           |

---

## Data Sources

| Provider | Dashboard                          | Data URL                           | Format   | CORS       | Proxy               |
| -------- | ---------------------------------- | ---------------------------------- | -------- | ---------- | ------------------- |
| AWS      | https://status.aws.amazon.com/     | `.../rss/all.rss`                  | RSS/XML  | ✅ Direct  | None                |
| Azure    | https://azure.status.microsoft/    | `azurestatuscdn.azureedge.net/...` | Atom/XML | ❌ Blocked | `/api/status/azure` |
| OCI      | https://ocistatus.oraclecloud.com/ | `.../api/v2/status.json`           | JSON     | ✅ Direct  | None                |
| GCP      | https://status.cloud.google.com/   | `.../incidents.json`               | JSON     | ✅ Direct  | None                |

**Coverage notes:**

- **AWS** — `all.rss` covers only incidents AWS publishes publicly (significant/widespread events). Minor single-service degradations appear only in per-service feeds.
- **Azure** — Public Atom feed covers only major widespread incidents. Per-service status is derived by matching incident titles against a canonical service list. Full per-region granularity requires the authenticated Azure Service Health ARM API.

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
│   │   ├── StatusHeader.tsx       Header: title, live dot, refresh button, theme toggle
│   │   ├── ProviderGrid.tsx       4-column responsive grid
│   │   ├── ProviderPanel.tsx      Per-provider expandable card + service list
│   │   ├── RegionTable.tsx        Region → top-10 service status rows (AWS, GCP)
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

The app deploys automatically to Vercel on every push to `main`.

```bash
# Push to trigger automatic deployment
git push origin main

# Manual production deploy (requires vercel CLI)
vercel --prod
```

Vercel auto-detects the Vite framework and Node.js serverless functions in `/api`. No additional configuration required beyond what is in `vercel.json`.

**Environment variables:** None required — all data sources are public and unauthenticated.

---

## Refresh and Caching Behavior

| Behavior                | Detail                                                          |
| ----------------------- | --------------------------------------------------------------- |
| Auto-refresh interval   | 60 seconds                                                      |
| Manual refresh cooldown | 60 seconds (starts after fetch completes)                       |
| Client cache (localStorage) | 60s TTL — hydrated on page load, matches poll interval     |
| Azure CDN cache         | `s-maxage=300, stale-while-revalidate=60` on Vercel Function    |
| Offline behavior        | Auto-refresh pauses; banner shown; cached data displayed        |
| Stale data indicator    | Yellow banner if last fetch failed but cached data is available |

---

## Observability

| Feature         | Status   | Notes                                             |
| --------------- | -------- | ------------------------------------------------- |
| Web Analytics   | ✅ Live  | Vercel Web Analytics — enable in dashboard        |
| Speed Insights  | ✅ Live  | Core Web Vitals tracking — enable in dashboard    |
| Function logs   | ✅ Live  | `vercel logs <url> --follow` or Logs tab          |

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

### Pending (see ENHANCEMENTS.md)

- Page visibility API — pause polling when tab is hidden
- OCI per-service status (API returns it; fetcher currently uses overall status)
- Aggregate status indicator in the header
- localStorage cache schema versioning
- Vite manual chunk splitting for `fast-xml-parser`
- Keyboard accessibility (`aria-expanded`, `aria-controls`) on expandable panels
- Top-level React error boundary

---

_Maintained by John Xanthopoulos — Marsh Cloud Engineering_
