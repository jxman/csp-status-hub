# Changelog

What has shipped, and the longer write-ups behind some of the design
decisions. The [README](./README.md) describes how the system works today;
this file records how it got there.

- [Shipped features and fixes](#shipped-features-and-fixes)
- [Design history](#design-history)

---

## Shipped features and fixes

Oldest first.

### Dashboard foundation

- React + Vite + TypeScript + Tailwind scaffold
- AWS, GCP, OCI live data via direct browser fetch
- Azure live data via Vercel serverless proxy (feed → normalized JSON)
- Top-10 canonical service status per provider (all four)
- Azure per-service status derived from incident title keyword matching
- Active incident list with severity and recency sorting
- Recently resolved incidents shown with green styling (24h window)
  - Azure's feed drops an incident the moment it clears, so `check-status.ts` saves the last-seen payload to Redis (`resolved:azure`, see `api/_lib/resolvedIncidents.ts`) when an Azure incident vanishes, and `/api/status/azure` merges those back in for 24h. The resolved time shown is when the cron noticed (≤5 min late), since Azure publishes no end time
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
- Bell icon in header opens a real sign-up form (double opt-in email alerting)
- Footer disclaimer (data source attribution, non-affiliation notice) + short About sentence for SEO
- Mobile-optimised 1×4 stat strip with condensed tile layout
- Deployment scripts: `npm run deploy` and `npm run deploy:preview` (lint → build → deploy → open)
- Operational service status now shown in green (was gray)
- Equal-width provider cards (4×1fr grid — first card no longer wider during outages)

### Provider data fixes

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
- OCI real per-incident feed (`incident-summary.rss`) wired in — region/service breakdown and the incident table now populate the same way AWS/GCP/Azure do, replacing the earlier `status.json`-only summary

### Alerts & Admin

- AWS EventBridge cron target endpoint drift fixed — see the README's [Known constraints](./README.md#known-constraints)
- Alerts & Admin: sign-up, double opt-in confirmation, manage/unsubscribe, admin subscriber list with CSV export and manual actions, ad hoc test-email tool, Sign in with Vercel admin auth, AWS EventBridge 5-minute change detection, resolution notifications (fires when a previously-active incident disappears from a provider's feed, not just when new ones appear), Upstash Redis status-snapshot cache (replacing an earlier Postgres table that kept Neon compute from autosuspending — see [Status snapshots moved to Redis](#status-snapshots-moved-from-postgres-to-redis))
- SEO: page `<h1>`, sitemap `lastmod`, `noindex` header on `/admin` and `/manage`, crawlable About text in the footer

### Incident Briefing Engine

- Phase 1: per-incident content-hash trigger (new/content_changed/resolved) layered on `check-status.ts`'s existing diff, fire-and-forget `/api/analysis/run` calling AWS Bedrock via Vercel OIDC federation, `incident_analysis` Postgres table
- Phase 2: public `/api/analysis/latest` read endpoint (originally `/api/analysis/history` with a version stepper; simplified 2026-08-29 to always show just the current version), lazy-fetched "AI Insight" panel on each incident card with a Technical/Executive toggle
- Phase 3: `@react-pdf/renderer`-generated, Synepho-branded PDF export per brief version, uploaded to Vercel Blob with a 1-year immutable cache, "Download PDF" links on the dashboard
- Phase 4 (final phase): outage/resolution emails link to a dashboard deep-link that auto-expands the right incident's AI Insight panel; admin run history, manual retry for failed rows, and live settings (debounce interval, per-provider kill switch)
- PDF polish (2026-08-29): fixed double-spaced body text (paragraph-block rendering instead of per-line blocks), removed a duplicate trailing disclaimer in the executive PDF, added a "Powered by Synepho" + site-URL line to the footer — see [PDF spacing fix](#pdf-spacing-fix-2026-08-29)
- AI Insight panel simplified (2026-08-29): dashboard now shows only the single latest brief per incident instead of a multi-version stepper (`/api/analysis/latest` replaces `/api/analysis/history`)
- About modal refreshed (2026-08-29): copy tightened to lead with the AI Insight feature; version bumped to 1.2.0 to reflect the Incident Briefing Engine work landed since the last bump
- Header logo now returns to the dashboard itself (2026-08-31): links to `cloudstatus.synepho.com` in the same tab instead of opening the personal site `synepho.com` in a new one — the footer's "Built by John Xanthopoulos" credit still links out to `synepho.com`
- AI Insight disclaimer reworded and now appended to both briefs (2026-08-31): no longer leads with DR/failover framing — states plainly that the brief is AI-generated guidance, the reader's environment may differ and need other steps, and not to assume automatic failover is configured. Previously appended only to the executive brief's closing line; now appended to both the technical and executive briefs (`api/_lib/analysisPrompt.ts`)
- Admin AI Run History: re-run enabled for any row, not just failed ones (2026-08-31): the row action menu (`RunHistoryPanel.tsx`) and `api/admin/analysis-admin.ts`'s `retry` action both dropped the `status='failed'` restriction, so a `complete` row can be forced to regenerate — e.g. to pick up a prompt change for an incident that's still active — without waiting for a natural `content_changed`/`resolved` trigger
- GCP `latestUpdate` fix — Description included, not just Summary (2026-09-01): GCP's Summary section is near-static boilerplate that repeats verbatim across every update for an incident, while the actual evolving narrative lives in Description; `extractGcpSummary()` was extracting Summary only, so both the incident card and the AI Insight content-change trigger (which hashes `latestUpdate`) went stale on real GCP incidents — see `claude.md`'s Known Constraints & Caveats table for the full writeup
- Stale-bundle detection + reload prompt (2026-09-01): a long-open tab can keep running the JS bundle it loaded with even while its 60s poll cycle keeps fetching fresh data, so a deploy's fix never reaches it until reloaded. `vite.config.ts` now emits `dist/version.json` from the same build timestamp baked into the bundle; the new `useVersionCheck()` hook (`src/hooks/useVersionCheck.ts`) polls it every 5 minutes and on tab-focus, and `App.tsx` shows a "new version available" banner with a Reload button on mismatch
- Admin AI Run History: Active/non-active badge, filter, and cleanup (2026-09-01) — see [Active/non-active cleanup](#activenon-active-run-cleanup-2026-09-01)
- AI Insight brief endpoint split into pointer + immutable content (2026-09-02) — see [Pointer/content split](#pointercontent-split-2026-09-02)
- Consolidated three endpoint pairs into one function each to stay under the Hobby plan's 12-function cap (2026-09-02) — see [Function-count fix](#function-count-fix-2026-09-02)
- AWS resolution-notification fix (2026-09-22): a subscriber reported getting the new-incident email but never the resolution email for an AWS EC2 `us-east-1` incident. Cause: AWS's `all.rss` feed doesn't always change an incident's `<title>` on its final update — this one kept "Service impact: Increased Error Rates" through its whole lifecycle and stated the resolution only in the `<description>` body. `awsFetcher.ts`'s `isResolved()` checked the title only, so the incident stayed stuck "active" in the Redis snapshot indefinitely. Now checks the description text too
- DMARC record added for `alerts.synepho.com` (2026-09-22): Resend's dashboard flagged "needs attention — no DMARC record found" (SPF/DKIM were already valid). Added `_dmarc.alerts.synepho.com` (`v=DMARC1; p=none; adkim=r; aspf=r`) via Route 53, now also provisioned by `scripts/setup-resend-dns.sh` so a from-scratch domain setup includes it
- Structured briefs (2026-09-29) — urgency-tagged fixed fields instead of free-form markdown; see the README's [Structured briefs](./README.md#structured-briefs)

### 2026-10-01

- Past incidents (90-day history) — README: [Past incidents](./README.md#past-incidents-90-day-history)
- Per-run retention cleanup in Admin AI Run History — README: [Run retention](./README.md#ai-run-history-and-retention)
- Vercel BotID removed; sign-ups protected by a honeypot plus per-email and daily limits — README: [Sign-up](./README.md#sign-up-and-confirmation)
- More sign-up entry points with GA4 `subscribe_open` / `subscribe_success` tracking — README: [Observability](./README.md#observability)
- Security pass (Snyk): Vite 6 → 7, ESLint 9 → 10, npm `overrides` for `@vercel/node`'s nested dependencies, `.snyk` policy, id-based admin PDF redirect

---

## Design history

### Status snapshots moved from Postgres to Redis

Per-provider status snapshots used for change detection originally lived in
a Postgres `provider_status_snapshot` table. Querying it every 5 minutes,
24/7, kept Neon's compute from ever autosuspending and blew through the
Free plan's 100 CU-hr/month allowance. Redis is billed by request count,
not compute uptime, so a cheap-but-constant workload no longer burns a
metered resource just by staying alive. The old table is left in place
(unused) rather than dropped, as a historical record.

**Confirmed via Neon's usage panel:** July (pre-fix, hit the cap on Jul 29)
used 102 of the 100 CU-hr Free plan allowance — ≈3.52 CU-hr/day averaged
over the month. August (post-fix) sat at 0.36 CU-hr through Aug 7 — ≈0.051
CU-hr/day, a ~69x drop — projecting to roughly 1.6 CU-hr for the full month.

### Pointer/content split (2026-09-02)

`/api/analysis/latest` used to return the full brief (both texts + PDF URLs)
with a 60s `s-maxage`/30s `stale-while-revalidate` — short enough that
sustained traffic (repeat page loads, several visitors opening the same
incident, a stuck-open tab being reloaded) could re-invoke the function,
and therefore re-query Neon, roughly once a minute — fast enough to defeat
Neon's autosuspend the same way the pre-Redis snapshot table once did.

Since `incident_analysis` rows never mutate after `status='complete'`
(`analysisPipeline.ts` INSERTs the row, then only best-effort backfills the
two PDF URLs via a `COALESCE` UPDATE), the read was split into a cheap
pointer request and an immutable content request. See the README's
[Reading a brief back](./README.md#reading-a-brief-back) for how it works
today.

### Function-count fix (2026-09-02)

The pointer/content split first shipped as two files — `api/analysis/latest.ts`
and a new `api/analysis/brief/[id].ts` — which pushed this Hobby-plan
deployment from 12 Serverless Functions (already at the cap) to 13 and broke
the next deploy (`No more than 12 Serverless Functions can be added to a
Deployment on the Hobby plan`). Folded back into one file (`?id=` on
`/api/analysis/latest` instead of a separate route), and two more pairs
consolidated the same way for headroom against the same cap:
`api/subscribe/index.ts` (bare `POST /api/subscribe`) merged into
`api/subscribe/[action].ts` as its `action === undefined` case, and
`api/admin/subscribers/index.ts` (bare `GET` list/CSV) merged into
`api/admin/subscribers/[id].ts` as its `id === null` case. Both reuse the
same bracket-file trick `analysis-admin.ts` already established — a
`vercel.json` rewrite maps the bare path to the bracket file with no dynamic
segment populated, which the handler reads as "no id/action given, so
list/create instead." No client-visible URL or behavior changed. Net: 10
functions deployed, down from what would have been 13.

### PDF spacing fix (2026-08-29)

`renderBriefBody()` originally rendered every line of the brief as its own
block-level `<Text>`, so `line-height` and `margin-bottom` both applied per
line instead of per paragraph — every multi-line section (e.g. adjacent
bullets) read as double-spaced. Now splits on real blank-line paragraph
breaks only, joining each paragraph's own lines with a literal `\n` inside
one `<Text>`. Also fixed the executive PDF repeating its closing disclaimer
twice (the prompt already appends it as the brief's own final line, on top
of the PDF's separate recurring footer) by stripping a trailing exact-match
copy before rendering.

### Active/non-active run cleanup (2026-09-01)

The dashboard only ever showed *active* incidents, but `incident_analysis`
rows (and their PDFs) accumulated forever once an incident rolled off the
live feed. Run History gained an Active/Non-active badge per row and an
"Active incidents only"/"Non-active only" filter, both driven by
`getActiveIncidentKeys()` — the same per-provider `activeIncidentIds` Redis
snapshot `check-status.ts` writes every 5 minutes. A "Clean up non-active"
button (plus a per-row Delete) permanently deleted matching rows and their
Vercel Blob PDFs. The bulk action failed closed if any provider's Redis
snapshot was missing or more than 24h stale.

Superseded on 2026-10-01 by per-run retention: once the Past incidents
section shipped, "non-active" no longer meant "unreachable", and
per-incident rules kept too much. See the README's
[AI run history and retention](./README.md#ai-run-history-and-retention).
