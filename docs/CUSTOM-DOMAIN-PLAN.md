# CSP Status Hub — Custom Domain Migration Plan

**Status:** In progress — Steps 1–8 done (domain live on `synepho.com`,
`APP_BASE_URL` cut over, OAuth callback allow-listed, redeployed; root-path
redirect bug found and fixed post-deploy; DNS record switched from a plain A
record to Vercel's recommended per-domain CNAME, see Step 2b). Step 9's
curl-able checks pass; remaining Step 9 items need a human click-through
(admin login, subscribe/unsubscribe email links, next cron run), then Step
10 (communicate the move).
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

- [x] DNS record change made through your Terraform project
      ([`jxman/synepho-s3cf-site`](https://github.com/jxman/synepho-s3cf-site)),
      not the Route 53 console/CLI directly — see Step 2 for what to add and
      where
- [x] Vercel access to the `johns-projects-2d2073fd` team / `csp-status-hub`
      project, with permission to add domains and edit env vars
- [ ] Access to wherever the Sign in with Vercel OAuth client was registered,
      to add the new callback URL as an allowed redirect URI
- [ ] A cutover window — low-risk since the audience is internal Marsh
      staff, but pick a time to run through verification calmly
- [ ] (Optional) Upgrade Vercel CLI first — currently 53.3.2, latest is
      56.3.1: `npm i -g vercel@latest`

## 5. Step-by-step plan

### Step 1 — Add the domain to the Vercel project ✅ Done (2026-07-17)

```bash
vercel domains add cloudstatus.synepho.com --scope johns-projects-2d2073fd
vercel domains inspect cloudstatus.synepho.com --scope johns-projects-2d2073fd
```

Ran this — the domain is attached to the project. Vercel's `inspect` output
came back recommending a plain **A record**, not the CNAME originally
assumed here:

```
a) Set the following record on your DNS provider: A cloudstatus.synepho.com 76.76.21.21  [recommended]
b) Or delegate synepho.com's nameservers to ns1.vercel-dns.com / ns2.vercel-dns.com
```

Option (b) is out — that would move the whole `synepho.com` zone's
nameservers to Vercel, taking `aws-services.synepho.com` and the root site
with it. Going with (a): a single A record, scoped to just this subdomain,
leaving the rest of the zone in Route 53 untouched.

### Step 2 — Add the DNS record via Terraform ✅ Done (2026-07-17)

Added directly into [`jxman/synepho-s3cf-site`](https://github.com/jxman/synepho-s3cf-site)'s
existing `modules/route53/main.tf`, alongside `root_site` / `www_site`, reusing that
module's `data.aws_route53_zone.selected` lookup and `var.site_name`
(so the answer to the "which state does this live in" question below was:
the same state, as a third record in the existing module):

```hcl
# Route53 record for cloud status page (Vercel)
resource "aws_route53_record" "cloudstatus_site" {
  zone_id = data.aws_route53_zone.selected.zone_id
  name    = "cloudstatus.${var.site_name}"
  type    = "A"
  ttl     = 300
  records = ["76.76.21.21"]
}
```

Applied, and DNS confirmed propagated by `ping cloudstatus.synepho.com`
resolving to `76.76.21.21`.

### Step 2b — Switched the A record to Vercel's recommended CNAME (2026-07-17)

After the `synepho.com` apex domain was separately added to the same Vercel
project (`vercel domains ls` — added ~1h before this was noticed, `Creator
jxman-2501`), re-inspecting `cloudstatus.synepho.com` started recommending a
**CNAME** to a unique per-domain hostname instead of the plain A record —
confirmed live via `dig`:

```
cloudstatus.synepho.com. IN CNAME 86f00b6411813bbf.vercel-dns-017.com.
86f00b6411813bbf.vercel-dns-017.com. IN A 216.198.79.65
86f00b6411813bbf.vercel-dns-017.com. IN A 64.29.17.65
```

Per [Vercel's docs](https://vercel.com/docs/domains/set-up-custom-domain):
apex/root domains must use an A record to the shared anycast IP (a DNS zone
apex can't hold a CNAME alongside other records like MX) — but a **subdomain**
should use a CNAME to a Vercel-hosted hostname. The unique per-domain form
(rather than the generic `cname.vercel-dns-0.com`) lets Vercel move the IPs
behind that hostname at any time — load rebalancing, infra changes, incident
failover — without any DNS change on our end. A hardcoded A record would
break if Vercel ever retired `76.76.21.21`.

[`jxman/synepho-s3cf-site`](https://github.com/jxman/synepho-s3cf-site)'s
`cloudstatus_site` Route53 record (Step 2, above) was updated from an `A`
record to a `CNAME` record pointing at
`86f00b6411813bbf.vercel-dns-017.com` to match. The rollback plan in Section
6 still applies — deleting this record doesn't affect anything else in the
zone.

### Step 3 — Verify domain + SSL ✅ Done (2026-07-17)

```bash
vercel domains inspect cloudstatus.synepho.com --scope johns-projects-2d2073fd
vercel certs ls --scope johns-projects-2d2073fd
curl -sI https://cloudstatus.synepho.com/
```

`inspect` no longer shows the "not configured properly" warning from Step
1 — DNS is validated. Cert `cert_J9Mv25dDX1aV7Ii6DP5rXRmi` is issued
(auto-renew on, 90-day expiry), and `curl -I` returns `HTTP/2 200` — the
app is live and serving over HTTPS on `cloudstatus.synepho.com`.

### Step 4 — Redirect the old `.vercel.app` URL (permanent, 308) ✅ Done (2026-07-17)

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

### Step 5 — Update the hardcoded `og:url` in `index.html` ✅ Done (2026-07-17)

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

### Step 6 — Update `APP_BASE_URL` ✅ Done (2026-07-17)

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

Ran this before Step 7 rather than after, reordering from the original plan:
Step 7 requires dashboard access Claude Code doesn't have, so it made more
sense to have the user add the new callback URL first, confirm it saved,
then flip `APP_BASE_URL` — avoiding any window where the app requests a
`redirect_uri` that isn't allow-listed yet.

### Step 7 — Update the Sign in with Vercel OAuth client ✅ Done (2026-07-17)

Add `https://cloudstatus.synepho.com/api/auth/callback` as an allowed
redirect URI on the OAuth client registration (wherever
`VERCEL_OAUTH_CLIENT_ID` was originally created). Leave the old callback URL
registered until Step 4's redirect is confirmed working end-to-end, then
remove it.

Done via **Team Settings → Apps → [app] → Authentication tab →
Authorization Callback URLs**, alongside the existing `.vercel.app` and
`localhost:3002` entries. This step cannot be done from the CLI — confirmed
in Section 10 of `ALERTS-DESIGN.md` that callback URL config only exists on
the dashboard-managed app object.

### Step 8 — Redeploy ✅ Done (2026-07-17)

```bash
npm run deploy   # lint + build + scripts/deploy.sh --prod
```

Ships the `vercel.json` redirect change, the `index.html` `og:url` fix, and
picks up the new `APP_BASE_URL`.

**Follow-up fix found during verification:** the first deploy's redirect
rule used the named-param form (`"source": "/:path*"`), which correctly
redirected every subpath but left the bare root `/` serving a stale cached
`200` indefinitely (`x-vercel-cache: HIT`, growing `age`, immune to
query-string cache-busting) — every other previously-cached path (e.g.
`/logos/aws.svg`) redirected fine, isolating the bug to root matching
specifically. Switched to the plain regex form Vercel's own docs use for
whole-site external redirects — `"source": "/(.*)"`,
`"destination": "https://cloudstatus.synepho.com/$1"` — and redeployed;
root now redirects correctly with query strings preserved.

### Step 9 — End-to-end verification

- [x] `https://cloudstatus.synepho.com` loads the dashboard (title + og:url
      confirmed via `curl`)
- [x] `curl -I https://csp-status-hub.vercel.app` returns a 308 to
      `https://cloudstatus.synepho.com` — verified for root, subpaths, and
      with query strings
- [x] `/api/auth/authorize` builds a `redirect_uri` of
      `https://cloudstatus.synepho.com/api/auth/callback`, matching the
      Step 7 allow-list entry
- [x] SSL cert valid (`HTTP/2 200`, no curl TLS errors)
- [x] `og:url` on the new domain reads `cloudstatus.synepho.com`
- [ ] Admin login (`/admin`) completes the full Vercel OAuth round-trip on
      the new domain — needs a human to click through, not curl-able
- [ ] Test subscribe → confirmation email link points to
      `cloudstatus.synepho.com` and completes
- [ ] Test unsubscribe link works
- [ ] Next scheduled cron runs (`check-status` at `0 0 * * *`, `cleanup` at
      `0 3 * * *` UTC) complete without error in Vercel's cron logs

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
3. Removing the A record (via `terraform apply` after deleting the resource
   block) doesn't affect `csp-status-hub.vercel.app` at all — the two are
   fully independent.

## 7. Known constraints & caveats

| Constraint | Detail |
| --- | --- |
| DNS lives outside Vercel | Every DNS change goes through the [`jxman/synepho-s3cf-site`](https://github.com/jxman/synepho-s3cf-site) Terraform project (plan → apply), not the Vercel dashboard — no automatic sync between Vercel and this domain, unlike domains bought through Vercel |
| `has: host` redirects are production-only | Per Vercel docs, `has` conditions don't evaluate under `vercel dev` — verify Step 4 against a real deployment |
| TTL during cutover | Keep the new record's TTL low (300s, or the ~50s Vercel sets on the CNAME per Step 2b) for the first 24–48h in case the target value needs correcting, then raise it |
| OAuth redirect URI allow-list | Missing Step 7 fails silently from the app's perspective — the error surfaces as a `redirect_uri` mismatch from Vercel's OAuth endpoint, not an obvious app-side bug |

## 8. Open decision

- Whether to also register `www.cloudstatus.synepho.com` — recommend
  skipping; this is an internal tool with no SEO/marketing need for a `www`
  variant.
