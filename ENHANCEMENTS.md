# CSP Status Hub — Enhancements & Optimizations

## Priority Order (remaining)

1. OCI per-service status
2. localStorage cache versioning
3. Everything else below

---

## Quick Wins

### ✅ Page title updates to reflect current status

_Completed — `bc48584`_

Browser tab dynamically updates to `⚠️ N Active Incidents — Cloud Status Hub` when
incidents are present; reverts to plain title when all clear.

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

### `formatTime` / `formatDateTime` are in the wrong file

Both functions are defined in `statusHelpers.ts` but belong in `formatters.ts`.
Minor code organization issue.
