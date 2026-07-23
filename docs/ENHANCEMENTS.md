# CSP Status Hub — Enhancements & Optimizations

## Priority Order (remaining)

1. OCI per-service status
2. localStorage cache versioning
3. Everything else below

---

## Quick Wins

### ~~Page title updates to reflect current status~~

_Reverted — `bc48584` → reverted_

Dynamic tab title (`⚠️ N Active Incidents — Cloud Status Hub`) was implemented but
reverted by user preference. Title is now the static "Cloud Status Hub" defined in
`index.html`.

### ✅ Favicon and meta tags (`index.html`)

_Completed — `bc48584`_

SVG favicon added (`/public/favicon.svg` — cloud icon with green status dot).
`<meta name="description">`, Open Graph, and Twitter card tags added to `index.html`.

### ✅ Speed Insights

_Completed — `bc48584`_

`@vercel/speed-insights` installed and `<SpeedInsights />` wired into `App.tsx`.
Enable in the Vercel dashboard under Speed Insights to start collecting Core Web Vitals.

---

## UX Improvements

### ✅ Page visibility polling pause

_Completed — `see commit history`_

Added `visibilitychange` listener to `useStatusPolling`. Polling pauses when the tab
is hidden and resumes with an immediate fetch when the tab returns to focus. Follows
the same pattern as the existing offline/online detection.

### OCI service list shows all services as affected during any incident

If OCI has a Storage outage, all 10 services in the panel show red/degraded. The OCI
API actually returns per-service status — the fetcher could pass that through instead
of applying the overall status to the whole list.

### No aggregate status indicator in the header

The header shows the refresh time but no overall status. A single green/yellow/red
dot next to "Cloud Status Hub" would let users know at a glance without scrolling.

### Incident count badge on collapsed panels

Collapsed panels only show a small yellow text count when incidents are present. A
colored badge on the panel header would be more visually scannable.

---

## Technical / Performance

### localStorage cache has no schema versioning

Cache key is `csp-status-hub:dashboard`. If the `ProviderStatus` schema changes in a
future update, stale cached data from a previous version gets deserialized and could
cause silent rendering bugs. Add a version suffix: `csp-status-hub:dashboard:v2`.

### ✅ Double-caching gap for Azure

_Completed — `90d25fe`_

Client-side localStorage TTL lowered to 60s for all providers, matching the poll
interval. Eliminates the risk of serving up to 10-minute-stale Azure data when the
CDN cache (5 min) and client cache (was 5 min) stacked. CDN handles the Azure
caching; client cache now only preserves data across a single refresh cycle.

### Vite bundle has no manual chunk splitting

Current build produces one ~225KB JS bundle. Splitting `fast-xml-parser` (used only
by the AWS fetcher at runtime) into a separate chunk would improve initial load time —
the XML parser only runs after the first data fetch, not on page render.

---

## Nice to Have

### Keyboard accessibility on expandable panels

The expand/collapse buttons in `ProviderPanel` and `RegionRow` have no `aria-expanded`
or `aria-controls` attributes. Screen readers cannot tell what the button does or what
it controls.

### No top-level error boundary

A React `ErrorBoundary` would catch unexpected render errors and show a graceful
fallback instead of a blank screen. One bad piece of data from any provider could
theoretically crash the whole app.

### ✅ `formatDateTime` / `formatRelative` hardened against Invalid Date

_Completed — this session_

Added `parseDate()` helper that checks `isNaN(d.getTime())` before use. All three
formatter functions now return `—` on unparseable input instead of "Invalid Date".
Azure RFC 2822 dates (`pubDate`) are also normalized to ISO 8601 server-side in
`api/status/azure.ts` before the response is returned.

### ✅ GCP active incidents dropped when `end` field is omitted

_Completed — this session_

`incidents.json` omits the `end` key entirely for ongoing incidents instead of
setting it to `null`. The fetcher's `active`/`recentlyResolved` filters used
`inc.end !== null`, and `undefined !== null` is `true` in JS, so any open incident
with no `end` key vanished from the dashboard entirely. Added `isIncidentOpen()`
in `gcpFetcher.ts` using loose `== null` to treat both the same.

### ✅ GCP incident detail link resolved to the wrong domain

_Completed — this session_

GCP's `uri` field is a relative path (`incidents/{id}`), not an absolute URL, so
`inc.uri ?? fallback` always picked the truthy-but-relative path — the "View
timeline" link resolved against `csp-status-hub.vercel.app` instead of GCP's
site. Added `buildGcpDetailUrl()` in `gcpFetcher.ts` to prefix it correctly.

### ✅ Incident cards showed stale start date instead of latest update

_Completed — this session_

`IncidentCard` always rendered `formatDateTime(incident.startTime)` for active
incidents, so a 9-day-old incident with an update from yesterday still showed
its original start date. Now shows `Updated {formatRelative(updatedAt)}`.

### ✅ `ProviderGrid` silently re-sorted by severity

_Completed — this session_

Cards were re-sorted by `overallStatus` (outage → degraded → unknown →
operational) on every render, contradicting the documented fixed provider
order. Removed the sort — `ProviderGrid` now renders `providers` in the order
returned by `useStatusPolling` (AWS → Azure → OCI → GCP), always.

### ✅ GCP service matching used hardcoded slugs that never matched real data

_Completed — this session_

GCP's `incidents.json` assigns each affected product an opaque doc-style ID
(e.g. `BSGtCUnz6ZmyajsjgTKv` for VPC). `GCP_CRITICAL_SERVICE_IDS` was matching
against invented slugs (`google-compute-engine`, etc.) that never matched
anything in the real feed, so canonical services always showed "Operational"
and *every* affected product — regardless of how many — was listed as an
individual extra row instead of collapsing.

Rewrote `gcpServices.ts` as `GCP_CRITICAL_SERVICES: GcpServiceDef[]` with
`keywords` matched case-insensitively against the product `title` (same
approach as `azureServices.ts`), and added `buildGcpServiceList()` in
`RegionTable.tsx` to always render the same top-10 list plus a single
"Multiple Services *" row for anything outside it — matching the AWS
display pattern. Also replaced the non-existent "Cloud Networking" entry
with "Virtual Private Cloud (VPC)", and made the "Multiple Services *"
footnote link provider-aware (`STATUS_PAGE_INFO` in `RegionTable.tsx`) since
it was previously hardcoded to always link to the AWS status page.

### ✅ Upgraded GCP matching from keyword-only to verified stable product IDs

_Completed — this session_

Discovered `https://status.cloud.google.com/products.json` — GCP's full
207-product catalog with permanent IDs. Cross-checked it against every
product ID seen across 3 sampled live incidents (49 unique products): zero
mismatches, confirming the opaque per-product ID is stable, not randomized
per incident as previously assumed.

Added a `productId` field to each `GCP_CRITICAL_SERVICES` entry, sourced
from that catalog. `buildGcpServiceList()` now matches by `productId` first
(exact, can't false-positive) and falls back to the title keyword only if
the ID ever stops resolving. Added `npm run verify:gcp`
(`scripts/verify-gcp-services.mjs`) to re-check all 10 `productId`s against
the live catalog on demand — flags exactly which service went stale and
whether the keyword fallback would still catch it.

### ✅ Azure showed no region/service breakdown during an active incident

_Completed — this session_

`azureFetcher.ts` always returned `regions: []`, so any active incident
replaced the whole panel with `IncidentTable`, a bespoke component that only
listed that one incident's own narrow service list — the canonical top-10
critical services (and their still-operational status) disappeared entirely
during an outage, exactly the gap the GCP fix above closed for GCP.
`azureFetcher.ts` now groups each active incident's parsed `affectedRegions` ×
`affectedServices` into a real region/service map, the same shape AWS/GCP/OCI
already produce. `RegionTable.tsx` gained `buildAzureServiceList()` matching
the existing GCP/OCI builders (top-10 always shown, extras collapsed into
"Multiple Services *"); `IncidentTable.tsx` and the ad hoc `ProviderPanel`-level
Azure logic it required were removed as dead code. Also swapped `Monitor` for
`Network Infrastructure` in `AZURE_CRITICAL_SERVICES`, matching what the feed's
categories actually report.

### ✅ Azure "View timeline" link pointed at Microsoft's internal backend host

_Completed — this session_

`entryToIncident()`'s `detailUrl` trusted the feed's own `<link>` element,
which Microsoft's feed populates with a raw backend App Service hostname
(e.g. `azurestatusprodeus.azurewebsites.net`) rather than the public
`azure.status.microsoft` domain — and the same generic root URL on every
entry regardless of incident, so it wasn't even incident-specific. `detailUrl`
now always uses the canonical public domain instead.
