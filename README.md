# Cloud Status Hub

Real-time operational status dashboard for AWS, GCP, OCI, and Azure in a single unified view. Built for Marsh internal leadership and cloud engineering staff.

Auto-refreshes every 60 seconds. Shows active incidents, per-service health, and links through to official vendor status pages.

---

## Architecture

```
Browser (React SPA)
        │
        ├─── Direct fetch (CORS-permissive) ─────────────────────────────┐
        │    AWS  → https://status.aws.amazon.com/rss/all.rss            │
        │    GCP  → https://status.cloud.google.com/incidents.json       │
        │    OCI  → https://ocistatus.oraclecloud.com/api/v2/status.json │
        │                                                                 │
        └─── Serverless proxy ──────────────────────────────────────────┘
             Azure only: /api/status/azure
                   └─→ Vercel Function (Node.js)
                          └─→ azurestatuscdn.azureedge.net/en-us/status/feed/
                                (Atom/XML → parsed → normalized JSON)

┌─────────────────────────────────────────────────────────────────────┐
│  useStatusPolling (React hook)                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────────┐ │
│  │awsFetcher│ │gcpFetcher│ │ociFetcher│ │azureFetcher (Phase 2) │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────────┬────────────┘ │
│       └─────────────┴─────────────┴──────────────────┘             │
│                    Promise.allSettled()                              │
│                    → DashboardStatus (unified schema)               │
│                    → localStorage cache (5-min TTL)                 │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  UI Layout                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ StatusHeader: title · live indicator · refresh · theme      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌──────────┬──────────┬──────────┬──────────────────────────┐    │
│  │ AWS      │ GCP      │ OCI      │ Azure                    │    │
│  │ Panel    │ Panel    │ Panel    │ Panel                    │    │
│  │ services │ services │ services │ (Phase 2)                │    │
│  └──────────┴──────────┴──────────┴──────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ IncidentList: active incidents across all providers         │   │
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
| XML Parsing | `fast-xml-parser` 4 (browser + serverless)      |
| Serverless  | Vercel Functions (Node.js, auto-detected)       |
| Deployment  | Vercel (Vite SPA + `/api` routes)               |

---

## Data Sources

| Provider | Dashboard                          | Data URL                           | Format   | CORS       | Proxy               |
| -------- | ---------------------------------- | ---------------------------------- | -------- | ---------- | ------------------- |
| AWS      | https://status.aws.amazon.com/     | `.../rss/all.rss`                  | RSS/XML  | ✅ Direct  | None                |
| GCP      | https://status.cloud.google.com/   | `.../incidents.json`               | JSON     | ✅ Direct  | None                |
| OCI      | https://ocistatus.oraclecloud.com/ | `.../api/v2/status.json`           | JSON     | ✅ Direct  | None                |
| Azure    | https://azure.status.microsoft/    | `azurestatuscdn.azureedge.net/...` | Atom/XML | ❌ Blocked | `/api/status/azure` |

**Coverage notes:**

- **AWS** — `all.rss` covers only incidents AWS publishes publicly (significant/widespread events). Minor single-service degradations appear only in per-service feeds.
- **Azure** — Public feed reports only major widespread incidents. Per-service/region detail requires Azure Service Health (authenticated ARM API). Phase 2 will add full serverless integration.

---

## Project Structure

```
csp-status-hub/
├── api/                          Vercel serverless functions
│   ├── status/
│   │   └── azure.ts              Azure Atom feed proxy (Phase 2)
│   └── _lib/
│       └── types.ts              Shared API-side types
│
├── src/
│   ├── App.tsx                   Root layout + banner logic
│   ├── main.tsx                  React entry point
│   ├── components/
│   │   ├── StatusHeader.tsx      Header: title, refresh, theme toggle
│   │   ├── ProviderGrid.tsx      4-column responsive grid
│   │   ├── ProviderPanel.tsx     Per-provider expandable card
│   │   ├── RegionTable.tsx       Region → top-10 service status rows
│   │   ├── FlatServiceList.tsx   Flat service list (OCI, healthy GCP)
│   │   ├── IncidentList.tsx      All active incidents, sorted by recency
│   │   ├── IncidentCard.tsx      Per-incident detail row
│   │   ├── StatusBadge.tsx       Color-coded status pill
│   │   ├── ServiceRow.tsx        Single service row in region view
│   │   └── ErrorState.tsx        Per-provider fetch failure fallback
│   ├── fetchers/
│   │   ├── awsFetcher.ts         RSS parse + GUID parsing + deduplication
│   │   ├── gcpFetcher.ts         incidents.json → normalized schema
│   │   ├── ociFetcher.ts         Statuspage.io indicator → normalized schema
│   │   └── azureFetcher.ts       Phase 2 stub (returns mock operational)
│   ├── hooks/
│   │   ├── useStatusPolling.ts   60s polling, cooldown, offline/cache logic
│   │   └── useTheme.ts           Light/dark toggle, localStorage persistence
│   ├── types/
│   │   └── status.ts             Unified schema (StatusLevel, ProviderStatus, etc.)
│   └── utils/
│       ├── awsServices.ts        AWS top-10 canonical service list
│       ├── gcpServices.ts        GCP top-10 canonical service list
│       ├── ociServices.ts        OCI top-10 canonical service list
│       ├── statusHelpers.ts      Status → color/label mapping
│       └── formatters.ts         Relative time formatting
│
├── public/
│   └── logos/                   Provider SVG logos
│
├── vercel.json                  Rewrite rules + function config
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── CLAUDE.md                    Architecture decisions and data source research
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

The Azure proxy (`/api/status/azure`) runs as a Vercel Function. In local development it returns a stub response — full Azure data requires deploying to Vercel or running `vercel dev`.

```bash
# Full local environment including serverless functions
npx vercel dev
```

---

## Deployment

The app deploys automatically to Vercel on every push to `main`.

```bash
# Push to trigger automatic deployment
git push origin main

# Manual production deploy
npx vercel --prod
```

Vercel auto-detects the Vite framework and Node.js serverless functions in `/api`. No additional configuration required.

**Environment variables:** None required for Phase 1 (all data sources are public/unauthenticated).

---

## Refresh and Caching Behavior

| Behavior                | Detail                                                          |
| ----------------------- | --------------------------------------------------------------- |
| Auto-refresh interval   | 60 seconds                                                      |
| Manual refresh cooldown | 60 seconds (starts after fetch completes)                       |
| Local cache             | `localStorage` — 5-minute TTL, hydrated on page load            |
| Offline behavior        | Auto-refresh pauses; banner shown; cached data displayed        |
| Stale data indicator    | Yellow banner if last fetch failed but cached data is available |

---

## Roadmap

### Phase 1 — Complete

- React + Vite + TypeScript + Tailwind scaffold
- AWS, GCP, OCI live data via direct browser fetch
- Top-10 canonical service status per provider
- Active incident list with severity and recency sorting
- Auto-refresh + manual refresh with rate limiting
- Offline detection + localStorage caching
- Light/dark mode
- Responsive mobile layout

### Phase 2 — Planned

- Azure serverless integration via `/api/status/azure` (Atom feed parse + normalize)
- Per-service and per-region breakdown for Azure (where available from public feed)
- Azure coverage disclaimer banner
- End-to-end test all four providers on Vercel preview

---

_Maintained by John Xanthopoulos _
