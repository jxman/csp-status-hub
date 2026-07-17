# CSP Status Hub — AWS Migration Assessment

**Status:** Planning / Assessment only — not committed  
**Date:** 2026-05-29  
**Project:** `csp-status-hub` (Vercel → AWS native services)

---

## Context

The app currently runs on Vercel, which provides three things: static SPA hosting (CloudFront-equivalent CDN), one serverless function (the Azure proxy), and analytics. The goal of this assessment is to understand what it would take to run the same workload entirely on AWS native services, with particular focus on how to replace the serverless function using Lambda and API Gateway.

**The app is very simple to migrate.** There is no database, no authentication, no secrets, and only a single serverless function. The migration is mostly infrastructure configuration, not code rewriting.

---

## What Vercel Is Currently Providing

| Capability | How Vercel Does It | AWS Equivalent |
|---|---|---|
| Serve React SPA (`dist/`) | Auto-CDN with SPA fallback | S3 + CloudFront |
| Cache-busted static assets | Per-deploy hashing via Vite | Same — Vite handles it; S3 upload + CloudFront invalidation |
| One serverless function: `GET /api/status/azure` | Auto-detected `api/**/*.ts`, Node.js runtime | Lambda (Node.js 22.x) + API Gateway |
| Function routing `/api/*` → function | `vercel.json` rewrites | API Gateway route or CloudFront behavior |
| Function timeout (10s) | `maxDuration: 10` in `vercel.json` | Lambda timeout config |
| CDN caching of function response (5 min) | `Cache-Control: s-maxage=300` header | CloudFront caching for API Gateway origin |
| Web analytics | `@vercel/analytics` npm package | CloudWatch RUM or drop entirely |
| Speed insights | `@vercel/speed-insights` npm package | CloudWatch RUM or drop |
| Logs | `vercel logs` | CloudWatch Logs |
| CI/CD | `scripts/deploy.sh` calls `vercel deploy` | GitHub Actions + `aws s3 sync` + Lambda deploy |

---

## Key Serverless Function Deep-Dive

### Why It Exists

Azure's Atom feed (`azurestatuscdn.azureedge.net`) blocks browser CORS requests. The other three providers (AWS, GCP, OCI) are CORS-permissive and fetched directly from the browser — they don't need a proxy. Azure is the **only** provider requiring a server-side hop.

### What the Function Does (`api/status/azure.ts`)

1. Receives `GET /api/status/azure` from the browser
2. Fetches Azure's Atom/XML feed server-side (no CORS issue)
3. Parses XML using `fast-xml-parser`
4. Maps incidents to the unified `ProviderStatus` schema
5. Returns JSON with `Cache-Control: s-maxage=300` (5-min CDN cache)

The function is stateless, has no external dependencies beyond `fast-xml-parser`, and completes in well under 10 seconds.

### How It Would Run on AWS — Lambda

The actual parsing and normalization logic stays **identical**. Only the function handler signature changes:

```typescript
// CURRENT (Vercel)
import type { VercelRequest, VercelResponse } from '@vercel/node';
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ...logic...
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
  res.json(normalized);
}

// AWS LAMBDA (drop-in replacement)
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  // ...same logic...
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 's-maxage=300, stale-while-revalidate=60',
    },
    body: JSON.stringify(normalized),
  };
};
```

---

## Architecture Options for Routing

The browser currently calls `/api/status/azure` as a **relative URL** (`azureFetcher.ts` line 3). In AWS, the static frontend and the API can be on different origins. How you handle this is the main architectural decision.

### Option A — Two Separate Domains *(Simplest to set up)*

```
Browser → https://status.example.com/                    → CloudFront → S3 (SPA)
Browser → https://api.example.com/api/status/azure        → API Gateway → Lambda
```

- Easy to configure independently
- **Requires a code change:** `azureFetcher.ts` must use an absolute URL (`VITE_API_BASE_URL` env var)
- **Requires CORS headers** on Lambda (`Access-Control-Allow-Origin: https://status.example.com`)

### Option B — Single CloudFront Distribution, Path-Based Routing *(Recommended)*

```
Browser → https://status.example.com/*         → CloudFront
                                                    ├── /api/*  → API Gateway origin
                                                    └── /*      → S3 origin (SPA fallback)
```

- Browser calls remain relative (`/api/status/azure`) — **zero code changes in `azureFetcher.ts`**
- No CORS headers needed (same origin)
- CloudFront behavior: `Path pattern: /api/*` → API Gateway origin; default → S3 origin
- Slightly more CloudFront config, but cleaner end state

**Recommendation: Option B** — keeps the frontend code unchanged and avoids CORS configuration complexity.

---

## AWS Infrastructure Components

### 1. S3 Bucket (Static Hosting)
- Public access blocked; served exclusively via CloudFront OAC (Origin Access Control)
- Contents: `dist/` output from `npm run build`
- Each deploy: `aws s3 sync dist/ s3://bucket --delete` + CloudFront cache invalidation

### 2. CloudFront Distribution
- **Default origin (S3):** serves `/*`
  - SPA fallback: custom error response, 404 → `/index.html` with HTTP 200
  - Cache policy: `index.html` = no-cache; `/assets/*` = 1 year immutable
- **Additional behavior (`/api/*` → API Gateway):** TTL 300s
- ACM certificate (must be in `us-east-1`) for custom domain
- OAC for S3 origin

### 3. API Gateway — HTTP API
- HTTP API (not REST API) — cheaper, lower latency, simpler config
- Single route: `GET /api/status/azure` → Lambda integration
- Stage: `$default` with auto-deploy
- No API keys, no usage plans needed
- CORS not required (Option B — same CloudFront domain)

### 4. Lambda Function
- Runtime: **Node.js 22.x**
- Architecture: **ARM64 (Graviton2)** — 20% cost savings
- Memory: 256 MB
- Timeout: 15 seconds
- IAM role: minimal — CloudWatch Logs write only
- Log group: `/aws/lambda/csp-status-hub-azure-proxy`, 14-day retention
- Logging: JSON structured format

### 5. IAM
- Lambda execution role with least-privilege CloudWatch Logs policy (scoped to specific log group ARN)
- GitHub Actions OIDC role for CI/CD — no long-lived access keys
  - Permissions: `s3:PutObject`, `s3:DeleteObject`, `cloudfront:CreateInvalidation`, `lambda:UpdateFunctionCode`

### 6. Route 53 (Optional)
- Only needed if moving DNS to AWS
- Alias records pointing to CloudFront distribution
- Existing DNS can CNAME to the CloudFront domain without Route 53

---

## Code Changes Required

| File | Change | Effort |
|---|---|---|
| `api/status/azure.ts` | Swap `VercelRequest/VercelResponse` → `APIGatewayProxyHandlerV2`; adjust return shape | ~30 min |
| `package.json` | Remove `@vercel/analytics`, `@vercel/speed-insights`, `@vercel/node`; add `@types/aws-lambda` | 10 min |
| `src/App.tsx` | Remove `<Analytics />` and `<SpeedInsights />` component imports and usage | 10 min |
| `scripts/deploy.sh` | Replace `vercel deploy` with S3 sync + CloudFront invalidation + Lambda update | 1 hr |
| `vercel.json` | Delete — replaced by CloudFront + API Gateway config | — |
| `.vercel/` directory | Delete | — |

**Files with zero changes needed (Option B routing):**
- `src/fetchers/azureFetcher.ts` — relative URL `/api/status/azure` stays as-is
- All other fetchers (`awsFetcher.ts`, `gcpFetcher.ts`, `ociFetcher.ts`) — direct browser fetches, untouched
- All React components, hooks, types, utils
- `vite.config.ts`, `tailwind.config.ts`, `tsconfig.json`

---

## Infrastructure-as-Code

Terraform is the recommended choice given the existing Terraform usage in related projects in this account.

**Suggested module layout:**
```
terraform/
├── main.tf           # Provider config, S3 backend for state
├── s3.tf             # Bucket + OAC policy
├── cloudfront.tf     # Distribution: dual origins, behaviors, SPA error response
├── lambda.tf         # Function + IAM role + log group (ARM64, JSON logging)
├── api_gateway.tf    # HTTP API + route + Lambda integration
├── acm.tf            # Certificate (us-east-1)
├── dns.tf            # Route 53 records (optional)
└── variables.tf
```

AWS SAM is a lighter alternative for Lambda-only deployments, but Terraform provides consistency with other projects in this account.

---

## CI/CD — GitHub Actions

Replace `scripts/deploy.sh` with a GitHub Actions workflow using OIDC (no long-lived keys):

```yaml
# Triggered on push to main
jobs:
  deploy:
    steps:
      - run: npm ci && npm run lint && npm run build     # Vite build → dist/
      - run: aws s3 sync dist/ s3://$BUCKET --delete
      - run: aws cloudfront create-invalidation --distribution-id $CF_ID --paths "/*"
      - run: |                                            # Compile + zip Lambda
          cd api && npx tsc && zip -r azure-proxy.zip .
          aws lambda update-function-code \
            --function-name csp-status-hub-azure-proxy \
            --zip-file fileb://azure-proxy.zip
```

---

## Cost Estimate

Assumes ~1,000 daily active users, browser polling every 60 seconds (generates ~1 Lambda call/minute/user for Azure data).

| Service | Estimated Monthly Cost |
|---|---|
| S3 storage (~5 MB) | < $0.01 |
| CloudFront (static assets) | < $1.00 |
| CloudFront (API path `/api/*`) | < $0.50 |
| Lambda invocations | Free tier: 1M/month free; beyond that ~$0.20/million |
| API Gateway HTTP API | ~$1.00/million requests |
| CloudWatch Logs | < $0.50 |
| **Estimated total** | **$0–$5/month at low traffic; scales with users** |

> Vercel's free tier is $0 with no per-invocation cost. AWS adds real (small) cost but provides account consolidation and full control.

---

## Effort Estimate

| Phase | Tasks | Estimated Time |
|---|---|---|
| Lambda refactor | Update function signature, swap types, local test | 2–3 hrs |
| Terraform — Lambda + API Gateway | `lambda.tf`, `api_gateway.tf`, IAM, log group | 3–4 hrs |
| Terraform — S3 + CloudFront | Dual-origin config, OAC, SPA fallback, cache policies | 3–5 hrs |
| CI/CD | GitHub Actions workflow + OIDC role | 2–3 hrs |
| DNS cutover | ACM cert validation, CNAME/Route 53 update | 1 hr |
| End-to-end testing | Browser test all 4 providers, CloudWatch logs, polling | 1–2 hrs |
| Cleanup | Remove Vercel project, packages, configs | 30 min |
| **Total** | | **~13–18 hours** |

Weekend-sized project for one engineer comfortable with Terraform and AWS.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| CloudFront path routing misconfiguration (403 on `/api/*`) | Medium | Test with `curl` against CloudFront before DNS cutover; keep Vercel live in parallel during transition |
| SPA deep-links returning 403 | Medium | CloudFront custom error response: 404 → `/index.html` (HTTP 200) |
| Lambda cold starts adding latency to first Azure fetch | Low | ARM64 reduces cold start time; 60s polling interval means cold starts are rare |
| CORS issues if Option A chosen | Medium | Mitigated by choosing Option B (single CloudFront domain) |
| Losing Vercel analytics | Low | `@vercel/analytics` and `@vercel/speed-insights` removed; consider CloudWatch RUM as replacement |

---

## Decision Summary

**Go/No-Go factors:**

| Factor | Assessment |
|---|---|
| Migration complexity | Low — one Lambda function, one S3 bucket, one CloudFront distribution |
| Code changes | Minimal — function signature wrapper only |
| Risk | Low — Vercel can remain live in parallel until cutover |
| Cost | Small positive (~$0–$5/month added cost) |
| Benefit | Account consolidation; full control; existing AWS tooling |
| Time investment | ~14–18 hours engineering time |

> **Bottom line:** If the goal is account consolidation or gaining experience with this AWS pattern, this is a clean, low-risk project. If the goal is simply "keep it running," Vercel's free tier is already optimal for this use case.
