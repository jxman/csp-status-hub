# Cloud Provider Status Dashboard — Claude Code Handoff Document

**Project Codename:** `csp-status-hub`  
**Author:** John Xanthopoulos  
**Date:** 2026-05-08 (rev 4 — AWS confirmed CORS-permissive; moved to direct browser fetch)

> **Scope update (2026-07):** Section 1's "Out of Scope" list below reflects
> the *original* kickoff decision and is left as a historical record. Alerting
> and subscriptions are now in scope and built — see
> [`README.md`](./README.md)'s **Alerts & Admin** section for that feature's
> architecture, data model, and as-built notes (previously its own
> `docs/ALERTS-DESIGN.md`, consolidated into the README once the feature went
> live). This document still accurately describes the dashboard itself (data
> sources, fetchers, unified schema).
>
> **Scope update (2026-08):** an AI-generated per-incident briefing feature
> ("Incident Briefing Engine" / the dashboard's "AI Insight" panel) was also
> never part of this doc's original scope and has since shipped in full
> (Bedrock-generated technical + executive briefs, branded PDF export,
> outage-email deep links, admin run history/retry/settings). See
> [`README.md`](./README.md)'s **Alerts & Admin → Incident Briefing Engine**
> section for its architecture and as-built notes; that section also covers
> two later revisions — the dashboard was changed to show only the single
> latest brief per incident (no version stepper), and its PDF export had a
> body-text spacing bug fixed and gained a "Powered by Synepho" footer line.

---

## 1. Project Overview

Build a **client-first, serverless-backed** React web application displaying real-time operational status for AWS, Azure, GCP, and OCI in a single unified view. Primary audience: Marsh internal leadership and cloud engineering staff. Data freshness is the priority — the app shows current status at time of viewing with auto-refresh.

**In Scope:**
- Current status per provider at page load, with auto-refresh polling (60s default)
- **Region-level AND service-level** status breakdown per provider
- Active incident list with affected services and regions
- Color-coded status: Operational (green), Degraded (yellow), Outage (red), Unknown (gray)
- Link-through to official vendor status pages

**Out of Scope:**
- Historical incident lookup, alerting, subscriptions
- Authenticated per-account health (AWS Health API, Azure Service Health ARM API)
- User authentication on the dashboard itself

---

## 2. Architecture — Mostly Client-Side + One Serverless Function

### Decision Summary

| Choice | Selected |
|---|---|
| Frontend | React + Vite |
| Backend | No persistent server — one serverless function (Azure only) |
| Deployment | Vercel (native Vite + `/api` serverless routes, free tier) |
| Status granularity | Region + service level |
| Styling | Tailwind CSS |
| Language | TypeScript |

### CORS Test Results (confirmed in browser DevTools)

Three of the four providers are CORS-permissive and can be fetched directly from the browser. Only Azure requires a serverless proxy.

| Provider | URL | CORS Result |
|---|---|---|
| AWS | `https://status.aws.amazon.com/rss/all.rss` | ✅ Confirmed — `fetch()` returns 200 |
| GCP | `https://status.cloud.google.com/incidents.json` | ✅ Confirmed |
| OCI | `https://ocistatus.oraclecloud.com/api/v2/status.json` | ✅ Confirmed |
| Azure | `https://rssfeed.azure.status.microsoft/en-us/status/feed/` | ❌ Blocked — proxy required |

### Data Fetching Architecture

```
React Client (Vite SPA)
        │
        ├─── Direct fetch (browser → CSP) ──────────────────────────────────────┐
        │       AWS:   https://status.aws.amazon.com/rss/all.rss    CORS ✅     │
        │       GCP:   https://status.cloud.google.com/incidents.json CORS ✅   │
        │       OCI:   https://ocistatus.oraclecloud.com/api/v2/status.json ✅  │
        │                                                                        │
        └─── Serverless proxy (browser → Vercel fn → CSP) ─────────────────────┘
                Azure only: /api/status/azure → rssfeed.azure.status.microsoft/...

                Vercel function handles:
                  fetch → Atom XML parse → normalize → return JSON
```

All four data paths deliver normalized JSON in the **same unified schema** to the React client. Azure is the only provider requiring a serverless function.

### Folder Structure

```
csp-status-hub/
├── claude.md                         ← This file
├── README.md
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── vercel.json                       ← Rewrites + function config
│
├── api/                              ← Vercel serverless functions (Node.js runtime)
│   ├── status/
│   │   └── azure.ts                  ← Azure only: fetch Atom feed, parse, normalize
│   └── _lib/
│       ├── azureFetcher.ts           ← Azure Atom fetch + parse logic
│       ├── normalizer.ts             ← Maps Atom format → unified schema
│       └── types.ts                  ← Shared TypeScript interfaces
│
├── src/                              ← React frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── StatusHeader.tsx          ← Timestamp, refresh button, countdown
│   │   ├── ProviderGrid.tsx          ← 4-column layout
│   │   ├── ProviderPanel.tsx         ← Expandable per-CSP panel
│   │   ├── RegionTable.tsx           ← Region × Service status matrix
│   │   ├── IncidentList.tsx          ← Active incidents across all providers
│   │   ├── IncidentCard.tsx          ← Per-incident detail row
│   │   ├── StatusBadge.tsx           ← Reusable color-coded pill
│   │   ├── ServiceRow.tsx            ← Single service status row within a region
│   │   └── ErrorState.tsx            ← Per-provider failure fallback
│   ├── hooks/
│   │   └── useStatusPolling.ts       ← Polling orchestration + state for all four providers
│   ├── fetchers/
│   │   ├── awsFetcher.ts             ← Browser-side AWS all.rss fetch + XML parse + normalize
│   │   ├── gcpFetcher.ts             ← Browser-side GCP fetch + normalize
│   │   └── ociFetcher.ts             ← Browser-side OCI fetch + normalize
│   ├── types/
│   │   └── status.ts                 ← Unified schema types (shared with api/)
│   └── utils/
│       ├── statusHelpers.ts          ← Status → color/label mapping
│       └── formatters.ts             ← Date/time formatting
│
└── public/
    └── logos/                        ← AWS, Azure, GCP, OCI SVG logos
```

### `vercel.json` Configuration

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/:path*" }
  ],
  "functions": {
    "api/**/*.ts": {
      "runtime": "nodejs20.x",
      "maxDuration": 10
    }
  }
}
```

---

## 3. Data Source Research — Full Detail

### 3.1 AWS — Amazon Web Services

| Attribute | Detail |
|---|---|
| **Public Dashboard** | `https://status.aws.amazon.com/` |
| **Data Format** | RSS/XML — single aggregated feed |
| **Feed URL** | `https://status.aws.amazon.com/rss/all.rss` |
| **Auth Required** | No |
| **CORS from Browser** | ✅ Confirmed — `fetch()` returns HTTP 200 directly from browser |
| **Feed TTL** | 5 minutes (AWS-specified — poll no more frequently than this) |
| **Authenticated API** | AWS Health API (requires IAM + Business/Enterprise Support plan) |

**Why `all.rss` instead of per-service/per-region feeds:**

`https://status.aws.amazon.com/rss/all.rss` is a single aggregated feed covering all services across all regions. This replaces what would otherwise be 100+ individual RSS requests (one per service per region combination). AWS maintains this feed with a TTL of 5 minutes and it is the same data that populates the public status dashboard. CORS is permissive — confirmed via browser `fetch()` returning HTTP 200 — so this is fetched directly from the React client with no proxy needed.

**Coverage note:** Like Azure's public page, `all.rss` reflects incidents that AWS determines meet the threshold for public broadcast — typically significant, widespread events. Minor single-service degradations may only appear in individual per-service RSS feeds (e.g., `rss/ec2-us-east-1.rss`). For this dashboard's audience (leadership + engineering quick reference), `all.rss` coverage is appropriate. This should be disclosed in the UI.

**GUID format — extracting service and region:**

Each `<guid>` in the feed follows a consistent pattern that encodes service and region:

```
https://status.aws.amazon.com/#{service_or_multipleservices}-{region}_{unix_timestamp}
```

Examples from live feed:
```
#multipleservices-me-south-1_1772556000    → multiple services, ME-SOUTH-1
#multipleservices-me-central-1_1772554485 → multiple services, ME-CENTRAL-1
#ec2-us-east-1_1234567890                 → EC2, US-EAST-1
#s3-eu-west-1_1234567890                  → S3, EU-WEST-1
```

Parsing logic (TypeScript):
```typescript
// Known AWS region suffixes — needed to correctly split service from region
// because both can contain hyphens (e.g. "ap-southeast-1", "elasticloadbalancing")
const AWS_REGIONS = new Set([
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
  'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-south-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-south-1', 'ap-south-2', 'ap-east-1',
  'sa-east-1', 'ca-central-1', 'ca-west-1',
  'me-south-1', 'me-central-1',
  'af-south-1', 'il-central-1',
  'us-gov-east-1', 'us-gov-west-1',
]);

function parseGuid(guid: string): { service: string; region: string } {
  const fragment = guid.split('#')[1] ?? '';           // "ec2-us-east-1_1234567890"
  const withoutTimestamp = fragment.split('_')[0];     // "ec2-us-east-1"

  for (const region of AWS_REGIONS) {
    const suffix = `-${region}`;
    if (withoutTimestamp.endsWith(suffix)) {
      const service = withoutTimestamp.slice(0, -suffix.length) || 'multipleservices';
      return { service, region };
    }
  }
  // Global/edge services (CloudFront, Route 53, IAM) have no region segment
  // in their GUID at all — e.g. "#cloudfront_1784201243". Label these
  // region "global" rather than falling through to "unknown".
  if (withoutTimestamp) return { service: withoutTimestamp, region: 'global' };
  return { service: 'unknown', region: 'unknown' };
}
```

**⚠️ Important: Items are incident UPDATES, not incidents**

The `all.rss` feed emits a new `<item>` for **every update** to an ongoing incident — not one item per incident. A major outage that lasts 12 hours with hourly updates will produce 12+ items in the feed, all sharing the same service and region in their GUIDs but with different timestamps.

The fetcher must deduplicate:
1. Group all `<item>` elements by their GUID base (strip the `_{timestamp}` suffix)
2. Within each group, keep only the item with the **most recent** `<pubDate>`
3. That latest item represents the current state of that incident

```typescript
function deduplicateItems(items: RssItem[]): RssItem[] {
  const groups = new Map<string, RssItem>();
  for (const item of items) {
    const base = item.guid.replace(/_\d+$/, '');   // strip trailing _timestamp
    const existing = groups.get(base);
    if (!existing || new Date(item.pubDate) > new Date(existing.pubDate)) {
      groups.set(base, item);
    }
  }
  return Array.from(groups.values());
}
```

**Title keyword → status mapping:**

| `<title>` prefix | Mapped Status |
|---|---|
| `Service disruption` | `outage` |
| `Service impact` | `degraded` |
| `Performance issues` | `degraded` |
| `Informational` | `notice` |
| No active items | `operational` |

**Client-side fetch behavior (`src/fetchers/awsFetcher.ts`):**
1. Fetch `https://status.aws.amazon.com/rss/all.rss` directly from browser — **one HTTP call, no proxy**
2. Parse XML with `fast-xml-parser` (runs in browser via npm bundle)
3. Extract all `<item>` elements
4. Deduplicate: group by GUID base, keep most recent `<pubDate>` per group
5. For each deduplicated item: parse service + region from GUID, infer status from title
6. Aggregate into `ProviderStatus` with `RegionStatus[]` containing `ServiceStatus[]`
7. Return normalized `ProviderStatus`

---

### 3.2 Azure — Microsoft Azure

| Attribute | Detail |
|---|---|
| **Public Dashboard** | `https://azure.status.microsoft/` |
| **Data Format** | Atom/XML |
| **Feed URL** | `https://rssfeed.azure.status.microsoft/en-us/status/feed/` |
| **Auth Required** | No |
| **CORS from Browser** | ❌ Blocked — use Vercel serverless `/api/status/azure` |
| **Authenticated API** | Azure Service Health via ARM API (Azure AD required) |

> **Update (2026-07-29):** feed URL switched from
> `https://azurestatuscdn.azureedge.net/en-us/status/feed/` to
> `https://rssfeed.azure.status.microsoft/en-us/status/feed/`. Confirmed
> both serve the identical response (same body, same Azure Front Door
> backend per the `x-azure-ref`/`request-context` headers) from the same
> origin — this isn't a functional migration, just moving off the generic
> `*.azureedge.net` CDN suffix onto a custom domain on the Azure Status
> brand, ahead of Microsoft's broader retirement of classic `*.azureedge.net`
> CDN infrastructure (Azure CDN from Edgio retired Jan 2025; Azure CDN
> Standard from Microsoft classic retires Sept 30, 2027). CORS is still
> blocked on the new URL too (no `Access-Control-Allow-Origin` header) —
> the Vercel serverless proxy is still required either way. The old CDN URL
> is still live and unchanged as of this date; this was a proactive switch,
> not a reaction to breakage. Also note: this doc's "Data Format: Atom/XML"
> row above is the original kickoff assumption — the feed actually serves
> RSS 2.0 (`<rss><channel><item>`), not Atom (`<feed><entry>`).
> `azureFetcher.ts` already parses both shapes (evidently discovered during
> implementation even though this table was never corrected), so no code
> change was needed here — flagging only so this table stops contradicting
> the actual code.

**⚠️ Critical Limitation — Region + Service Granularity:**

Azure's public status page intentionally covers only three categories of incident: (1) broad impact across multiple services and regions, (2) when the Azure portal itself is inaccessible, or (3) when their standard notification channel is down. The Atom feed provides no structured per-region or per-service breakdown — each entry is free-text narrative. This means:

- **True service-level and region-level granularity is not available without authentication**
- The best available from the public feed: parse each Atom `<entry>` title/summary for service names and region names using string matching/regex
- Azure's card in the UI must display a disclaimer explaining this coverage gap

> **Update (2026-07-23):** the structural limitation above is still true — Azure's
> feed only ever reports what Microsoft chooses to publish — but as of this date
> `azureFetcher.ts` no longer leaves `regions: []` for every incident. It groups
> each active incident's parsed `affectedRegions`/`affectedServices` into a real
> region → service map and renders it through the same `<RegionTable />` matrix
> AWS/GCP/OCI use, with a canonical top-10 critical-service list
> (`azureServices.ts`) and a "Multiple Services *" catch-all for anything outside
> it. See `README.md`'s Alerts & Admin section for the as-built details —
> the "UI Treatment for Azure" bullets below describe the original kickoff plan,
> which predates this and no longer matches exactly (there's no "Limited Data"
> badge; the coverage note is a plain info banner).

**Serverless function behavior (`/api/status/azure.ts`):**
1. Fetch Atom feed
2. Parse XML, extract all `<entry>` elements
3. For each entry: extract title, published, updated, summary
4. Attempt to parse affected services/regions from free-text using regex patterns
5. Set overall status: 0 entries → `operational`; entries present → parse severity from text
6. Return normalized JSON with explicit `coverageNote` field set

**UI Treatment for Azure:**
- Show overall status indicator
- List active incident entries with their full narrative text
- Display a persistent info banner inside the Azure panel: *"Azure's public status page reports only major widespread incidents. For account-specific or service-specific health, see Azure Service Health in the Azure portal."*
- The `<RegionTable />` component renders with a "Limited Data" badge for Azure

---

### 3.3 GCP — Google Cloud Platform

| Attribute | Detail |
|---|---|
| **Public Dashboard** | `https://status.cloud.google.com/` |
| **Data Format** | JSON (structured, stable schema) |
| **Incidents JSON URL** | `https://status.cloud.google.com/incidents.json` |
| **Atom Feed** | `https://status.cloud.google.com/feed.atom` |
| **Auth Required** | No |
| **CORS from Browser** | ✅ Confirmed — fetch directly from the React client |

**Why GCP is the best data source for region + service granularity:**
The structured JSON includes `updates[].affected_locations[]` with machine-readable location IDs, and `affected_products[]` with product IDs. This maps cleanly to the service × region matrix view without any text parsing.

**JSON Schema (key stable fields):**
```typescript
// Each item in incidents.json
{
  "id": string,
  "number": number,
  "begin": string,           // ISO 8601 start time
  "end": string | null,      // null = ACTIVE incident
  "severity": "low" | "medium" | "high",
  "external_desc": string,   // Human-readable title
  "affected_products": [
    { "title": string, "id": string }
  ],
  "updates": [
    {
      "created": string,
      "modified": string,
      "text": string,
      "status": "SERVICE_DISRUPTION" | "SERVICE_INFORMATION" | "AVAILABLE",
      "affected_locations": [
        { "title": string, "id": string }   // e.g. "us-east1", "europe-west1"
      ]
    }
  ]
}
```

**Active incident detection:** `"end": null`

**Client-side fetch (`src/fetchers/gcpFetcher.ts`):**
1. Fetch `https://status.cloud.google.com/incidents.json`
2. Filter for `end === null` (active incidents)
3. Derive overall status from worst severity across active incidents
4. Map `affected_locations[]` to `RegionStatus[]`
5. Map `affected_products[]` to `ServiceStatus[]`

---

### 3.4 OCI — Oracle Cloud Infrastructure

| Attribute | Detail |
|---|---|
| **Public Dashboard** | `https://ocistatus.oraclecloud.com/` |
| **Data Format** | JSON (structured) |
| **JSON Status URL** | `https://ocistatus.oraclecloud.com/api/v2/status.json` |
| **RSS URL** | `https://ocistatus.oraclecloud.com/api/v2/incident-summary.rss` |
| **Gov Regions** | `https://gov.ocistatus.com/` (separate endpoint — out of scope v1) |
| **Auth Required** | No |
| **CORS from Browser** | ✅ Confirmed — fetch directly from the React client |

**Why OCI is ideal for region + service granularity:**
OCI's JSON is explicitly structured as `regionHealthReports[]` containing `serviceHealthReports[]`. This is the most directly usable format of all four providers for a region × service matrix — no parsing or inference needed.

**JSON Schema (key fields):**
```typescript
{
  "realm": "OC1",
  "regionHealthReports": [
    {
      "regionId": string,
      "regionName": "US East (Ashburn)",
      "regionCanonicalName": "us-ashburn-1",
      "geographicAreaName": "North America",
      "serviceHealthReports": [
        {
          "serviceId": string,
          "serviceName": "Compute",
          "serviceCanonicalName": "compute",
          "serviceCategoryName": "Cloud Services",
          "serviceStatus": "NormalPerformance" | "DegradedPerformance" | "PartialOutage" | "MajorOutage",
          "incidents": [ ... ]
        }
      ]
    }
  ]
}
```

**OCI Status Mapping:**

| OCI `serviceStatus` | Normalized Status |
|---|---|
| `NormalPerformance` | `operational` |
| `DegradedPerformance` | `degraded` |
| `PartialOutage` | `degraded` |
| `MajorOutage` | `outage` |

---

## 4. CSP Source URL Quick Reference

| Provider | Dashboard | Primary Data URL | Format | Auth? | CORS? |
|---|---|---|---|---|---|
| AWS | `https://status.aws.amazon.com/` | `https://status.aws.amazon.com/rss/all.rss` | RSS/XML | No | ✅ Direct (confirmed) |
| Azure | `https://azure.status.microsoft/` | `https://rssfeed.azure.status.microsoft/en-us/status/feed/` | RSS/XML | No | ❌ Proxy required |
| GCP | `https://status.cloud.google.com/` | `https://status.cloud.google.com/incidents.json` | JSON | No | ✅ Direct (confirmed) |
| OCI | `https://ocistatus.oraclecloud.com/` | `https://ocistatus.oraclecloud.com/api/v2/status.json` | JSON | No | ✅ Direct (confirmed) |

---

## 5. Unified Data Schema (TypeScript)

```typescript
// Shared between src/types/status.ts AND api/_lib/types.ts

export type StatusLevel = "operational" | "degraded" | "outage" | "unknown";
export type Provider = "aws" | "azure" | "gcp" | "oci";

export interface ServiceStatus {
  serviceId: string;
  serviceName: string;
  status: StatusLevel;
  incidents: string[];             // Active incident IDs affecting this service
}

export interface RegionStatus {
  regionId: string;                // e.g. "us-east-1", "us-ashburn-1", "us-east1"
  regionName: string;              // e.g. "US East (N. Virginia)"
  geographicArea: string;          // e.g. "North America"
  overallStatus: StatusLevel;      // Worst status across all services in this region
  services: ServiceStatus[];
}

export interface Incident {
  id: string;
  title: string;
  status: "investigating" | "identified" | "monitoring" | "resolved" | "unknown";
  severity: "low" | "medium" | "high";
  startTime: string;               // ISO 8601
  endTime: string | null;          // null = still active
  affectedServices: string[];      // Service names
  affectedRegions: string[];       // Region IDs
  detailUrl: string;
  latestUpdate: string;            // Most recent status message text
  updatedAt: string;               // ISO 8601
}

export interface ProviderStatus {
  provider: Provider;
  displayName: string;
  overallStatus: StatusLevel;
  regions: RegionStatus[];
  activeIncidents: Incident[];
  sourceUrl: string;
  dataFetchedAt: string;           // ISO 8601 — when data was retrieved
  coverageNote?: string;           // Used for Azure disclaimer, AWS scope note
  fetchError?: string;             // Set if fetch partially or fully failed
}

export interface DashboardStatus {
  providers: ProviderStatus[];
  lastRefreshedAt: string;         // ISO 8601
}
```

---

## 6. UI Layout and Component Behavior

### Page Structure

```
┌─────────────────────────────────────────────────────────────┐
│ CSP Status Hub                      Last refreshed: 14:32   │
│                        [Refresh Now]  Auto-refresh: 45s...  │
├──────────┬──────────┬──────────┬───────────────────────────┤
│  AWS     │  Azure   │  GCP     │  OCI                      │
│  🟢 OK   │  🟡 Deg  │  🟢 OK   │  🔴 Outage               │
│  0 inc   │  1 inc   │  0 inc   │  2 inc                    │
│  [note]  │  [note]  │          │                           │
├──────────┴──────────┴──────────┴───────────────────────────┤
│  [Expanded: OCI]                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ OCI — Region × Service Status Matrix                 │  │
│  │          Compute  Networking  Storage  Database      │  │
│  │ Ashburn  🔴        🟢          🟢       🟡           │  │
│  │ Phoenix  🟢        🟢          🟢       🟢           │  │
│  │ Frankfurt🟢        🟡          🟢       🟢           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ACTIVE INCIDENTS                                           │
│  🔴 OCI — Compute Outage — US East (Ashburn)               │
│     Since 13:55 UTC · High · [View on OCI Status →]        │
│  🟡 Azure — Multiple Services — Widespread                  │
│     Since 12:10 UTC · Medium · [View on Azure Status →]    │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Props | Behavior |
|---|---|---|
| `<App />` | — | Orchestrates polling, holds `DashboardStatus` state, renders layout |
| `<StatusHeader />` | `lastRefreshedAt`, `onRefresh`, `isRefreshing` | Shows timestamp, countdown, refresh button with 15s cooldown |
| `<ProviderGrid />` | `providers: ProviderStatus[]` | 4-column CSS Grid; renders a `<ProviderPanel />` per provider |
| `<ProviderPanel />` | `provider: ProviderStatus` | Summary card; expands to show `<RegionTable />` on click |
| `<RegionTable />` | `provider: ProviderStatus` | Region-rows × service-columns matrix; cell = `<StatusBadge />` |
| `<IncidentList />` | `providers: ProviderStatus[]` | Aggregates + sorts all `activeIncidents` by severity then recency |
| `<IncidentCard />` | `incident: Incident`, `provider: Provider` | Title, severity, affected services/regions, latest update, link |
| `<StatusBadge />` | `status: StatusLevel`, `size?` | Colored pill: green/yellow/red/gray; supports `sm`, `md`, `lg` |
| `<ErrorState />` | `provider: Provider`, `error: string` | Graceful "Unable to fetch" card — does not block rest of dashboard |

### Key UI Behaviors
- **Auto-refresh:** Poll all four sources every 60 seconds; visible countdown
- **Manual refresh:** Button with 15-second cooldown
- **Error resilience:** One provider failure → `<ErrorState />` for that card only; other three unaffected
- **Expand/collapse:** Each provider panel collapses to summary and expands to full region × service matrix
- **No-incidents state:** Explicit "All systems operational" — never leave an ambiguous empty table
- **AWS + Azure disclaimer:** Persistent coverage note inside each respective panel
- **Stale data indicator:** If last refresh failed, show "Last successful refresh: X min ago" warning

---

## 7. Polling Architecture (`useStatusPolling.ts`)

```typescript
const fetchAll = async (): Promise<DashboardStatus> => {
  const [awsResult, gcpResult, ociResult, azureResult] = await Promise.allSettled([
    fetchAws(),            // Direct browser fetch → status.aws.amazon.com/rss/all.rss
    fetchGcp(),            // Direct browser fetch → status.cloud.google.com
    fetchOci(),            // Direct browser fetch → ocistatus.oraclecloud.com
    fetchFromApi('azure'), // → Vercel /api/status/azure (only provider needing proxy)
  ]);
  // Rejected results → ProviderStatus with fetchError set
  return buildDashboardStatus([awsResult, gcpResult, ociResult, azureResult]);
};
// Poll every 60s via setInterval; clear on unmount
// Immediate fetch on mount; manual refresh with 15s cooldown
```

> **Update (2026-08-06):** the pseudocode above (single `Promise.allSettled` gating
> one `dashboard` state) reflects the original kickoff plan but no longer matches
> `useStatusPolling.ts`. In production, the header rendered instantly but the rest of
> the page — `ProviderGrid`, `StatsBanner`, `IncidentList` — stayed on the loading
> skeleton until *all four* providers had settled, so the slowest provider (and there
> was no fetch timeout anywhere) determined how long the whole page waited. The hook
> now holds a per-provider map (`Record<Provider, ProviderStatus | null>`) instead of
> one atomic `DashboardStatus`; each of the four fetches is wrapped in the new
> `withTimeout()` (`src/utils/withTimeout.ts`, 12s budget) and updates its own slot
> in state the instant it resolves, so `ProviderGrid` can render three real cards
> immediately while a fourth still shows `<ProviderCardSkeleton />`. `Promise.all`
> (not `allSettled`) is still awaited across the four wrapped promises, but only to
> drive whole-cycle bookkeeping (`isRefreshing`, cooldowns, cache save) — not to gate
> any card's render. The one exception: if *all four* time out or fail (e.g. the
> user's network is down), the previous known-good per-provider data is left in
> place rather than replaced with four error cards — same "preserve stale data over
> showing nothing" behavior the original design had, just re-implemented per-provider
> instead of as one all-or-nothing swap.

---

## 8. Vercel Serverless Functions

Only **one** serverless function is needed — Azure is the only provider that cannot be fetched directly from the browser.

### `/api/status/azure.ts`

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { XMLParser } from 'fast-xml-parser';

const AZURE_FEED_URL = 'https://rssfeed.azure.status.microsoft/en-us/status/feed/';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const response = await fetch(AZURE_FEED_URL);
  const xml = await response.text();

  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const entries = [parsed.feed?.entry ?? []].flat(); // normalize single entry to array

  // Build ProviderStatus from Atom entries
  // Each <entry> → extract title, published, summary
  // 0 entries → operational; entries present → parse severity from title text
  // Always set coverageNote: "Azure public status reflects only major widespread incidents..."

  res.setHeader('Cache-Control', 's-maxage=60');
  res.json(normalized);
}
```

### Dependencies

```json
{
  "dependencies": {
    "fast-xml-parser": "^4.4.0",
    "@vercel/node": "^3.0.0"
  }
}
```

> Note: `fast-xml-parser` is also used **client-side** in `src/fetchers/awsFetcher.ts` to parse the AWS RSS feed directly in the browser. It is a pure JS library with no Node.js dependencies and bundles cleanly with Vite.

---

## 9. Known Constraints & Caveats

| Constraint | Detail | Mitigation |
|---|---|---|
| **AWS coverage** | `all.rss` covers only incidents AWS publishes publicly — significant events only | UI disclaimer in AWS panel; link to full dashboard |
| **AWS item deduplication** | Feed emits one `<item>` per update, not per incident | Group by GUID base, keep latest `<pubDate>` per group (see Section 3.1) |
| **AWS global/edge services** | GUIDs for CloudFront, Route 53, IAM, etc. carry no region segment (e.g. `#cloudfront_1784201243`) — found in production 2026-07-16 when a live CloudFront incident rendered as region "unknown" | `parseGuid()` labels these region `"global"` instead of falling through to `unknown`/`unknown` (see Section 3.1) |
| **Azure coverage** | Only major widespread incidents | UI disclaimer; link to full dashboard |
| **CORS — Azure only** | Azure Atom feed blocks direct browser fetches | Handled by single Vercel serverless function |
| **Azure region/service data now built from the feed's own `<category>`/title parsing** (2026-07-23) | The Section 3.2 "no structured per-region or per-service breakdown" limitation was true of the raw feed, but `azureFetcher.ts` now groups each active incident's parsed `affectedRegions` × `affectedServices` into a real region → service map — the same shape AWS/GCP/OCI already produce, rather than always returning `regions: []` | `RegionTable.tsx` gained `buildAzureServiceList()` (top-10 always shown from `AZURE_CRITICAL_SERVICES`, extras collapsed into "Multiple Services *"), matching `buildGcpServiceList()`/`buildOciServiceList()`. `IncidentTable.tsx` — the old ad hoc per-incident list this replaced — was deleted as dead code. See `README.md`'s Alerts & Admin section |
| **Azure feed `<link>` points at an internal backend host, not the public domain** (found 2026-07-23) | Each RSS/Atom entry's `<link>` is a raw backend App Service hostname (e.g. `azurestatusprodeus.azurewebsites.net`), not `azure.status.microsoft` — and it's the same generic root URL on every entry, not an incident-specific deep link | `entryToIncident()` ignores the feed's `<link>` and always sets `detailUrl` to the canonical `azure.status.microsoft` dashboard URL |
| **AWS XML in browser** | `fast-xml-parser` must run client-side to parse RSS | Pure JS lib — bundles cleanly with Vite, no issues |
| **Vercel cold starts** | First Azure call after inactivity may add 1–2s | Loading indicator in UI; other three providers unaffected |
| **Vercel free tier** | 100k fn invocations/month — only Azure calls count now | Even more headroom than before |
| **Stale data** | 60s poll cycle; AWS TTL is 5min — status may lag | Show `dataFetchedAt` timestamp in UI |
| **OCI gov regions** | `gov.ocistatus.com` is a separate endpoint | Out of scope v1 |
| **OCI `status.json` alone has no incident-level data** | `api/v2/status.json` is a bare `{indicator, description}` page summary, not the `regionHealthReports[]` schema shown above (that schema was never actually implemented against a real endpoint) | `ociFetcher.ts` now also reads `api/v2/incident-summary.rss` (this section's own RSS URL, above) — one stable-guid `<item>` per incident, no dedup needed, status keyword maps directly to `Incident['status']` — for real region/service/incident detail. `status.json` is kept only as the `overallStatus` source and as a safety net (a synthetic `oci-current-incident` id still fires if the two sources disagree). See `README.md`'s Alerts & Admin section |
| **OCI region ids are display names, not canonical slugs** | `incident-summary.rss` gives human region names (`"US East (Ashburn)"`), not a slug like AWS's `us-east-1` | `regionId` uses the raw display name as-is rather than a hand-built name→slug table that would need per-region verification and upkeep |
| **GCP `end` field omitted** | `incidents.json` omits `end` entirely for ongoing incidents instead of setting it `null` | Treat `end == null` (loose) rather than `end !== null` (strict) — see `isIncidentOpen()` in `gcpFetcher.ts` |
| **GCP `uri` is relative** | `incidents.json`'s `uri` field is a path like `incidents/{id}`, not an absolute URL | Prefix with `https://status.cloud.google.com/` — see `buildGcpDetailUrl()` in `gcpFetcher.ts` |
| **GCP `affected_products[].id` is opaque but stable** | Each product ID is an opaque doc-style hash (e.g. `BSGtCUnz6ZmyajsjgTKv` for VPC), not a human-readable slug like AWS's — but it IS permanent. Verified via `https://status.cloud.google.com/products.json` (the full 207-product catalog): all IDs seen across sampled incidents matched the catalog exactly | Match canonical top-10 services by hardcoded `productId` (sourced from `products.json`) with title-keyword as fallback — see `GCP_CRITICAL_SERVICES` in `gcpServices.ts` and `buildGcpServiceList()` in `RegionTable.tsx`. Run `npm run verify:gcp` to re-validate all 10 `productId`s against the live catalog at any time |
| **No fetcher had a request timeout** (found 2026-08-06 — user noticed the header drew instantly but the rest of the page lagged behind it) | None of the four fetchers or `api/status/azure.ts` used `AbortController`/a timeout, and `useStatusPolling.ts` gated the entire page on `Promise.allSettled` across all four — so the slowest (or a genuinely hung) provider blocked every card, not just its own | `useStatusPolling.ts` now updates each provider's own state slot as soon as its fetch resolves (see Section 7's 2026-08-06 update), and wraps each fetch in `withTimeout()` (`src/utils/withTimeout.ts`, 12s) so a hung provider surfaces as an error card within a bounded time instead of stalling indefinitely |
| **GCP `latestUpdate` only reflected the boilerplate Summary section** (found 2026-09-01 — user reported the dashboard still showing the "initial outage" text after GCP had posted newer updates showing recovery progress) | Each incident update's `text` packs multiple `**Header**` sections (Summary, Description, Customer Symptoms, Workaround). Summary is a near-static restatement of the incident title that stays word-for-word identical across every update GCP posts for a given incident, while the actual evolving narrative (mitigation progress, recovery status) lives in Description — `extractGcpSummary()` was extracting Summary only, so the incident card never visibly changed. This had a second-order effect: `check-status.ts`'s `hashIncidentContent()` hashes `latestUpdate` (among other fields) to decide whether to re-trigger the AI Insight brief, so a GCP incident's brief went stale in lockstep with the card | `extractGcpSummary()` (`src/fetchers/gcpFetcher.ts`) now joins Summary + Description. Verified against a live incident (3 successive updates, identical Summary text, differing Description) that the combined string now differs update to update |
| **A long-open tab can keep running a stale JS bundle after a deploy ships a fix** (found 2026-09-01, immediately after the GCP fix above — user's already-open tab kept showing pre-fix behavior even though it was genuinely re-fetching fresh JSON every 60s) | This is a static SPA with no service worker; the 60s poll cycle only re-fetches provider JSON and re-renders with whatever JS is already loaded in memory — a new deploy's fixed code never reaches a tab that hasn't reloaded | `vite.config.ts` emits `dist/version.json` from the same `buildDate` baked into the bundle as `__BUILD_DATE__`. The new `useVersionCheck()` hook (`src/hooks/useVersionCheck.ts`) polls that file every 5 minutes and on tab-visibility change; `App.tsx` shows a "new version available" banner with a Reload button when it no longer matches — see `README.md`'s Roadmap for the full writeup |

---

## 10. Open Decisions (Remaining)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | **OCI gov regions** | In scope, Out of scope | Out of scope v1 |
| 2 | **Default expanded provider** | None, First with incidents, AWS | First provider with active incidents |
| 3 | **Dark mode** | Yes, No | Yes (Tailwind `dark:` classes) |
| 4 | **Vercel vs Netlify** | Both support serverless + Vite | Vercel (simpler DX) |

---

## 11. Implementation Phases

### Phase 1 — Foundation (start here)
- [ ] Scaffold Vite + React + TypeScript + Tailwind project
- [ ] Add `vercel.json` config
- [ ] Define shared TypeScript schema (`src/types/status.ts`)
- [ ] Implement `gcpFetcher.ts` — direct browser fetch, normalize to schema
- [ ] Implement `ociFetcher.ts` — direct browser fetch, normalize to schema
- [ ] Implement `awsFetcher.ts` — direct browser fetch of `all.rss`, parse with `fast-xml-parser`, deduplicate items, normalize to schema
- [ ] Build `useStatusPolling.ts` with AWS + GCP + OCI wired in (mock Azure only)
- [ ] Build `<ProviderPanel />`, `<StatusBadge />`, `<StatusHeader />` with live data
- [ ] Verify all three direct-fetch providers end-to-end in browser

### Phase 2 — Azure Serverless + Full Coverage
- [ ] Create `/api/status/azure.ts` — fetch Atom feed, parse XML, normalize
- [ ] Wire Azure into `useStatusPolling.ts` via `fetchFromApi('azure')`
- [ ] Build `<RegionTable />` — region × service matrix
- [ ] Implement `<IncidentList />` + `<IncidentCard />`
- [ ] AWS and Azure disclaimer banners
- [ ] End-to-end test all four providers on Vercel preview deployment

### Phase 3 — Polish + Resilience
- [ ] `<ErrorState />` per-provider failure isolation
- [ ] Skeleton loading states (first load)
- [ ] Auto-refresh countdown indicator
- [ ] Manual refresh with 15s cooldown
- [ ] Dark mode (`dark:` Tailwind variants)
- [ ] Responsive layout (mobile for leadership)
- [ ] `coverageNote` rendered as info banner in AWS + Azure panels

---

## 12. Claude Code Kickoff Prompt

Open Claude Code from the project root directory (`/Users/johxan/Documents/my-projects/csp-status-hub`) and use this starter prompt:

> *"I'm building a cloud provider status dashboard called `csp-status-hub`. Read `claude.md` in this directory — it defines the complete architecture, data sources, unified TypeScript schema, component breakdown, and phased implementation plan.*
>
> *Start with Phase 1. Stack: React + Vite, TypeScript, Tailwind CSS. Azure is the only provider requiring a Vercel serverless function in `/api` — AWS, GCP, and OCI are all fetched directly from the browser (CORS confirmed).*
>
> *Begin by: (1) scaffolding the project structure exactly as defined in the claude.md folder layout, (2) implementing the shared TypeScript types in `src/types/status.ts`, (3) implementing `gcpFetcher.ts` using the `incidents.json` endpoint and schema in Section 3.3, (4) implementing `ociFetcher.ts` using the `status.json` endpoint and schema in Section 3.4, (5) implementing `awsFetcher.ts` using the `all.rss` endpoint with the GUID parsing and item deduplication logic defined in Section 3.1. All three use direct browser fetch — no proxy needed."*

---

*Maintained by: John Xanthopoulos, Cloud Engineering — Marsh*  
*Next review: After Phase 1 completion*
