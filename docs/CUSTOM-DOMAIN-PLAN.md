# CSP Status Hub — Custom Domain Migration Plan

**Status:** Planning — not yet started
**Author:** Claude Code (drafted for John Xanthopoulos)
**Date:** 2026-07-17
**Depends on:** `../claude.md` (base architecture), `ALERTS-DESIGN.md` (`APP_BASE_URL` usage, Sign in with Vercel OAuth)

---

## 1. Goal

Move `csp-status-hub` off `csp-status-hub.vercel.app` onto a `synepho.com`
subdomain, with a permanent redirect from the old URL so existing bookmarks
and links keep working. Zero downtime; alert/subscribe/admin-auth flows must
keep functioning through the cutover.

## 2. Decisions made

- **New subdomain:** `cloudstatus.synepho.com`
- **Old `.vercel.app` URL treatment:** permanent (308) redirect

## 3. Current state (confirmed by investigation)

- `synepho.com` DNS is hosted in **Route 53** (AWS) — nameservers are
  `ns-*.awsdns-*` — **not** Vercel-managed DNS.
- The existing `aws-services.synepho.com` subdomain is S3 + CloudFront,
  unrelated to Vercel. There's no existing Vercel↔Route 53 CNAME precedent in
  this AWS account to copy from — this is a first-of-its-kind setup for this
  domain.
- Vercel project: `csp-status-hub` (`prj_qpZnELfLjPk08yIsa6wIhcoQFG12`) on
  team `johns-projects-2d2073fd`.
- Current domains on the project: `csp-status-hub.vercel.app` (primary),
  plus two deployment-specific alias domains.
- `APP_BASE_URL` is the single env var the app uses to build every absolute
  URL. It's read in:
  - `api/auth/authorize.ts` / `api/auth/callback.ts` — Sign in with Vercel
    OAuth `redirect_uri`
  - `api/subscribe/index.ts`, `api/admin/subscribers/[id].ts` — confirmation
    email links
  - `api/subscribe/unsubscribe.ts`, `api/subscribe/confirm.ts`
  - `api/cron/check-status.ts`
- Admin login (`/admin`) uses **Sign in with Vercel** OAuth
  (`VERCEL_OAUTH_CLIENT_ID` / `VERCEL_OAUTH_CLIENT_SECRET`). The OAuth client
  has an allow-listed redirect URI tied to the current domain — this has to
  be updated or admin login breaks with a `redirect_uri` mismatch.
- No hardcoded references to `csp-status-hub.vercel.app` exist in `api/` or
  `src/` — all provider-status source URLs (`status.aws.amazon.com`, etc.)
  are third-party and unaffected. **`index.html` is the one exception** —
  its `og:url` meta tag (line 20) is hardcoded to
  `https://csp-status-hub.vercel.app/` and isn't driven by `APP_BASE_URL`,
  so it won't update itself when that env var changes — see Step 5.
- `RESEND_EMAIL_DOMAIN` (outbound alert emails, currently `alerts@<domain>`)
  is an independent concern — not required to change as part of this move,
  just an optional cosmetic upgrade if you later want `alerts@synepho.com`.

## 4. Prerequisites checklist

- [ ] AWS console/CLI access to the Route 53 hosted zone for `synepho.com`
      (to add a CNAME record)
- [ ] Vercel access to the `johns-projects-2d2073fd` team / `csp-status-hub`
      project, with permission to add domains and edit env vars
- [ ] Access to wherever the Sign in with Vercel OAuth client was registered,
      to add the new callback URL as an allowed redirect URI
- [ ] A cutover window — low-risk since the audience is internal Marsh
      staff, but pick a time to run through verification calmly
- [ ] (Optional) Upgrade Vercel CLI first — currently 53.3.2, latest is
      56.3.1: `npm i -g vercel@latest`

## 5. Step-by-step plan

### Step 1 — Add the domain to the Vercel project

```bash
vercel domains add cloudstatus.synepho.com --scope johns-projects-2d2073fd
# or via dashboard: Project Settings → Domains → Add
vercel domains inspect cloudstatus.synepho.com
```

This returns the exact DNS target Vercel wants (typically a CNAME to
`cname.vercel-dns.com` for subdomains) — confirm the literal value from
`inspect` rather than assuming it.

### Step 2 — Add the DNS record in Route 53

In the `synepho.com` hosted zone, add:

```
Name:  cloudstatus.synepho.com
Type:  CNAME
Value: <value returned by Step 1's `vercel domains inspect`>
TTL:   300   (short during cutover; raise to 3600 once stable)
```

### Step 3 — Verify domain + SSL

```bash
vercel domains inspect cloudstatus.synepho.com   # → "Valid Configuration"
vercel certs ls                                   # confirm cert issued
```

Vercel auto-provisions the TLS cert once DNS validates, usually within
minutes of the CNAME propagating.

### Step 4 — Redirect the old `.vercel.app` URL (permanent, 308)

Vercel's project-domain "redirect" field (the one used for custom-domain-to-
custom-domain moves) doesn't cleanly apply to a project's *default*
`<name>.vercel.app` alias, since that's auto-assigned rather than a domain
you add yourself. A host-matched rule in `vercel.json` is the reliable
mechanism regardless of how Vercel handles the default alias internally:

```json
{
  "redirects": [
    {
      "source": "/:path*",
      "has": [{ "type": "host", "value": "csp-status-hub.vercel.app" }],
      "destination": "https://cloudstatus.synepho.com/:path*",
      "permanent": true
    }
  ]
}
```

Add this as the **first** entry in the existing `redirects` array in
`vercel.json` — redirects are evaluated in order, before rewrites, and this
project's rewrites already include a catch-all (`/(.*) → /index.html`) that
would otherwise take precedence. Note: `has: host` conditions only evaluate
on Vercel's production routing layer — they're a no-op under `vercel dev`,
so test this against a real deployment, not locally.

### Step 5 — Update the hardcoded `og:url` in `index.html`

```html
<!-- before -->
<meta property="og:url" content="https://csp-status-hub.vercel.app/" />

<!-- after -->
<meta property="og:url" content="https://cloudstatus.synepho.com/" />
```

This is a static meta tag, not sourced from `APP_BASE_URL`, so it's the one
place in the app that needs a manual source-code edit rather than an env var
change. Easy to miss since it has no runtime effect (nothing breaks or
errors) — it only matters when a link to the dashboard gets shared on
Slack/Teams/social and the preview card points back at the old domain. Bundle
this edit into the same commit as the Step 4 `vercel.json` change so both
ship in Step 8's redeploy.

### Step 6 — Update `APP_BASE_URL`

```bash
vercel env rm APP_BASE_URL production
vercel env add APP_BASE_URL production
# value: https://cloudstatus.synepho.com
```

This is the critical cutover step — every confirmation email link,
unsubscribe link, cron-triggered check, and OAuth `redirect_uri` is built
from this value. Do this **after** Step 3 confirms the new domain is live,
so there's no window where an outbound email links to a domain that isn't
serving traffic yet.

### Step 7 — Update the Sign in with Vercel OAuth client

Add `https://cloudstatus.synepho.com/api/auth/callback` as an allowed
redirect URI on the OAuth client registration (wherever
`VERCEL_OAUTH_CLIENT_ID` was originally created). Leave the old callback URL
registered until Step 4's redirect is confirmed working end-to-end, then
remove it.

### Step 8 — Redeploy

```bash
npm run deploy   # lint + build + scripts/deploy.sh --prod
```

Ships the `vercel.json` redirect change, the `index.html` `og:url` fix, and
picks up the new `APP_BASE_URL`.

### Step 9 — End-to-end verification

- [ ] `https://cloudstatus.synepho.com` loads the dashboard; all four
      provider panels populate
- [ ] `curl -I https://csp-status-hub.vercel.app` returns a 308 to
      `https://cloudstatus.synepho.com`
- [ ] Admin login (`/admin`) completes the full Vercel OAuth round-trip on
      the new domain
- [ ] Test subscribe → confirmation email link points to
      `cloudstatus.synepho.com` and completes
- [ ] Test unsubscribe link works
- [ ] Next scheduled cron runs (`check-status` at `0 0 * * *`, `cleanup` at
      `0 3 * * *` UTC) complete without error in Vercel's cron logs
- [ ] SSL cert valid, no browser warnings
- [ ] View page source (or a social-preview debugger) on the new domain and
      confirm `og:url` reads `cloudstatus.synepho.com`, not the old domain

### Step 10 — Communicate the move

The Step 4 redirect makes this a soft cutover — anyone with the old URL
bookmarked lands on the new domain automatically, no forced action needed.
Optionally send a short internal note to Marsh leadership / cloud
engineering with the new URL for their bookmarks, since 308 redirects get
cached fairly aggressively by browsers and are otherwise invisible to users.

## 6. Rollback plan

If something breaks post-cutover:

1. Revert `APP_BASE_URL` to `https://csp-status-hub.vercel.app` and
   redeploy — the app keeps working on the old domain regardless of whether
   the new domain stays attached, since nothing is removed, only added.
2. The `vercel.json` redirect rule can be reverted independently (delete the
   one entry) if it interferes with anything.
3. Removing the CNAME in Route 53 doesn't affect `csp-status-hub.vercel.app`
   at all — the two are fully independent.

## 7. Known constraints & caveats

| Constraint | Detail |
|---|---|
| DNS lives outside Vercel | Every DNS change is a manual Route 53 edit — no automatic sync between Vercel and this domain, unlike domains bought through Vercel |
| `has: host` redirects are production-only | Per Vercel docs, `has` conditions don't evaluate under `vercel dev` — verify Step 4 against a real deployment |
| TTL during cutover | Keep the new CNAME's TTL low (300s) for the first 24–48h in case the target value needs correcting, then raise it |
| OAuth redirect URI allow-list | Missing Step 6 fails silently from the app's perspective — the error surfaces as a `redirect_uri` mismatch from Vercel's OAuth endpoint, not an obvious app-side bug |

## 8. Open decision

- Whether to also register `www.cloudstatus.synepho.com` — recommend
  skipping; this is an internal tool with no SEO/marketing need for a `www`
  variant.
