#!/bin/bash
# Audits and rotates csp-status-hub's secrets (GitHub issue #4).
#
# DRY RUN BY DEFAULT: nothing in Vercel or AWS changes unless --apply is
# passed. Read-only calls (listing env vars, finding the current production
# deployment) still run in a dry run so the printed plan is accurate.
#
# Two kinds of secret:
#   - Self-managed (cron, session): generated here with openssl and written
#     straight to Vercel. Fully automatic.
#   - Connected services (resend, blob, upstash, neon): Vercel has no public
#     API to trigger their "Rotate Secrets" button, so the script opens the
#     dashboard, waits for the click, then does everything after it
#     (redeploy, wait for the new build, re-pull .env.local, credential check).
#
# --secure splits a readable ("Needs Attention") variable into a Sensitive
# Production + Preview copy and a readable Development copy, because Vercel
# doesn't allow Sensitive values in Development and local dev still needs
# them. Whether Vercel allows this on service-owned variables (and whether a
# later service rotation undoes it) is unverified, so try it on one KEY first.
#
# Secrets never go on a command line: values are piped through stdin or
# written to mode-600 temp files that are removed on exit.
#
# Usage: see usage() below, or run with -h.
set -euo pipefail

PROJECT_ID="prj_qpZnELfLjPk08yIsa6wIhcoQFG12"
TEAM_ID="team_4iOB63ypDBtGH3z7aWJZuqUv"
SITE_URL="https://cloudstatus.synepho.com"
# Same names as scripts/setup-eventbridge-cron.sh
CONNECTION_NAME="csp-status-hub-cron-connection"
RULE_NAME="csp-status-hub-check-status"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_LOCAL="$ROOT_DIR/.env.local"

APPLY=false
ASSUME_YES=false
MODE=""
TARGET=""
SECURE_AFTER=false
MAX_AGE_DAYS=90

usage() {
  cat <<'EOF'
Usage:
  scripts/rotate-secrets.sh --audit [--max-age DAYS]
  scripts/rotate-secrets.sh --rotate <target> [--secure] [--apply] [--yes]
  scripts/rotate-secrets.sh --secure <service|KEY> [--apply] [--yes]

Targets:
  cron      CRON_SECRET in Vercel and the EventBridge connection (automatic)
  session   SESSION_SECRET (automatic; logs out admin sessions)
  resend    RESEND_API_KEY (guided: manual "Rotate Secrets" click)
  blob      BLOB_READ_WRITE_TOKEN (guided)
  upstash   KV_* / REDIS_URL (guided; old token stops working immediately)
  neon      DATABASE_URL / POSTGRES_* / PG* (guided; old password stops working immediately)

Options:
  --audit          Read-only. List flagged variables and production secrets
                   older than --max-age days (default 90). Exits 1 if any.
  --rotate T       Rotate target T.
  --secure X       Make a service's flagged variables (or one KEY) Sensitive
                   for Production + Preview, keeping a readable Development copy.
                   With --rotate, runs after the rotation for that service.
  --apply          Actually make changes. Without it, prints the plan only.
  --yes            Skip the confirmation prompt (the manual click wait for
                   guided rotations still happens).
  -h, --help       Show this help.

Suggested order for a first real run: resend or blob, then upstash, then neon.
EOF
}

# ---------- output helpers ----------

step() { printf '\n== %s ==\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
would() { printf '  [dry-run] would %s\n' "$*"; }

TMP_FILES=()
cleanup() { [ ${#TMP_FILES[@]} -gt 0 ] && rm -f "${TMP_FILES[@]}"; return 0; }
trap cleanup EXIT
secret_tmp() {
  local f
  f=$(mktemp)
  chmod 600 "$f"
  TMP_FILES+=("$f")
  printf '%s' "$f"
}

confirm() {
  $APPLY || return 0
  $ASSUME_YES && return 0
  printf '\n%s [y/N] ' "$1"
  local reply
  read -r reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "aborted"
}

# ---------- Vercel helpers ----------

# vapi PATH [vercel api options...] — appends teamId to PATH's query string
vapi() {
  local path="$1"
  shift
  local sep='?'
  [[ "$path" == *\?* ]] && sep='&'
  vercel api "${path}${sep}teamId=${TEAM_ID}" --raw "$@" 2>/dev/null
}

ENV_JSON=""
load_envs() { ENV_JSON=$(vapi "/v10/projects/$PROJECT_ID/env") || die "could not list env vars (vercel api)"; }

# updatedAt of KEY's record that targets production
prod_updated_at() {
  jq -r --arg k "$1" '[.envs[] | select(.key == $k and (.target | index("production")))][0].updatedAt // empty' <<<"$ENV_JSON"
}

build_date() { curl -fsS "$SITE_URL/version.json?_=$(date +%s)" | jq -r .buildDate; }

redeploy_production() {
  step "Redeploy production"
  local dep before
  dep=$(vapi "/v6/deployments?projectId=$PROJECT_ID&target=production&state=READY&limit=1" | jq -r '.deployments[0].uid // empty')
  [ -n "$dep" ] || die "could not find the current production deployment"
  before=$(build_date)
  if ! $APPLY; then
    would "run: vercel redeploy $dep --target production"
    would "wait for $SITE_URL/version.json to change from $before"
    return
  fi
  vercel redeploy "$dep" --target production
  info "waiting for $SITE_URL/version.json to change from $before (up to 10 min)"
  local now
  for _ in $(seq 1 40); do
    now=$(build_date 2>/dev/null || echo "")
    if [ -n "$now" ] && [ "$now" != "$before" ]; then
      info "new build live: $now"
      return
    fi
    sleep 15
  done
  die "production build didn't change within 10 minutes; check the Vercel dashboard"
}

pull_env_local() {
  step "Refresh .env.local"
  if ! $APPLY; then
    would "back up .env.local to .env.local.bak and run: vercel env pull .env.local --environment=development --yes"
    return
  fi
  [ -f "$ENV_LOCAL" ] && cp "$ENV_LOCAL" "$ENV_LOCAL.bak" && info "backup: .env.local.bak (gitignored; delete once you're happy)"
  (cd "$ROOT_DIR" && vercel env pull .env.local --environment=development --yes >/dev/null)
  info "pulled Development variables into .env.local"
}

credential_check() {
  step "Credential check ($1)"
  if ! $APPLY; then
    would "run: node --env-file=.env.local scripts/rotate-secrets-check.mjs $1"
    return
  fi
  (cd "$ROOT_DIR" && node --env-file=.env.local scripts/rotate-secrets-check.mjs "$1")
}

# ---------- audit ----------

# Production secrets whose age matters. Readable-secret flags are reported
# for every variable regardless of this list.
SECRET_KEYS='["CRON_SECRET","SESSION_SECRET","VERCEL_OAUTH_CLIENT_SECRET","RESEND_API_KEY","BLOB_READ_WRITE_TOKEN","KV_REST_API_TOKEN","KV_REST_API_READ_ONLY_TOKEN","KV_URL","REDIS_URL","DATABASE_URL","DATABASE_URL_UNPOOLED","POSTGRES_PASSWORD","PGPASSWORD","POSTGRES_URL","POSTGRES_URL_NO_SSL","POSTGRES_URL_NON_POOLING","POSTGRES_PRISMA_URL","NEON_AUTH_BASE_URL"]'

run_audit() {
  step "Audit (read-only)"
  load_envs
  local now_ms report
  now_ms=$(( $(date +%s) * 1000 ))
  report=$(jq -r --argjson now "$now_ms" --argjson max "$MAX_AGE_DAYS" --argjson secrets "$SECRET_KEYS" '
    [.envs[]
      | . as $e
      | ((($now - .updatedAt) / 86400000) | floor) as $age
      | ((.securityIssues // []) | join(",")) as $issues
      | (($secrets | index($e.key)) != null and (.target | index("production")) != null and $age > $max) as $old
      | select($issues != "" or $old)
      | [.key, .type, (.target | join(",")), "\($age)d",
         ([if $issues != "" then $issues else empty end, if $old then "older than \($max)d" else empty end] | join("; "))]
    ] | sort_by(.[0])[] | @tsv' <<<"$ENV_JSON")
  if [ -z "$report" ]; then
    info "nothing flagged; no production secret older than ${MAX_AGE_DAYS} days"
    return 0
  fi
  { printf 'KEY\tTYPE\tTARGETS\tAGE\tISSUE\n'; printf '%s\n' "$report"; } | column -t -s $'\t' | sed 's/^/  /'
  echo
  info "$(printf '%s\n' "$report" | wc -l | tr -d ' ') variable(s) need attention"
  return 1
}

# ---------- self-managed secrets ----------

new_secret() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }

update_vercel_secret() {
  local key="$1" value="$2"
  if ! $APPLY; then
    would "set $key (production) to a new 48-char random value, stored as Sensitive"
    return
  fi
  printf '%s' "$value" | vercel env update "$key" production --sensitive --yes >/dev/null
  info "updated $key (production, Sensitive)"
}

rotate_session() {
  step "Rotate SESSION_SECRET"
  info "effect: every admin session is signed with it, so you'll need to sign in to /admin again"
  confirm "Rotate SESSION_SECRET in production?"
  update_vercel_secret SESSION_SECRET "$(new_secret)"
  redeploy_production
  info "Development copy left unchanged (it's separate from production by design)"
}

# Polls CloudWatch until the rule has fired at least once since $1 (ISO time),
# then fails if any of those invocations failed (a 401 from the endpoint
# counts as a failed API-destination invocation).
verify_cron_invocations() {
  local since="$1" inv failed until_ts
  info "waiting for the next EventBridge run (fires every 5 min; metrics lag 1–3 min, so up to 12 min)"
  for _ in $(seq 1 48); do
    until_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    inv=$(aws cloudwatch get-metric-statistics --namespace AWS/Events --metric-name Invocations \
      --dimensions Name=RuleName,Value="$RULE_NAME" --start-time "$since" --end-time "$until_ts" \
      --period 60 --statistics Sum --query 'sum(Datapoints[].Sum)' --output text 2>/dev/null || echo 0)
    if [ "${inv%.*}" -ge 1 ] 2>/dev/null; then
      failed=$(aws cloudwatch get-metric-statistics --namespace AWS/Events --metric-name FailedInvocations \
        --dimensions Name=RuleName,Value="$RULE_NAME" --start-time "$since" --end-time "$until_ts" \
        --period 60 --statistics Sum --query 'sum(Datapoints[].Sum)' --output text 2>/dev/null || echo 0)
      if [ "${failed%.*}" -ge 1 ] 2>/dev/null; then
        die "EventBridge reported $failed failed invocation(s) since $since; check the connection value and the check-status logs"
      fi
      info "EventBridge fired $inv time(s) since $since with no failures"
      return
    fi
    sleep 15
  done
  warn "no EventBridge invocation recorded in 12 minutes; check the rule in the AWS console"
}

rotate_cron() {
  step "Rotate CRON_SECRET"
  command -v aws >/dev/null || die "aws CLI not found"
  aws sts get-caller-identity >/dev/null 2>&1 || die "AWS credentials not working (run: aws login)"
  aws events describe-connection --name "$CONNECTION_NAME" >/dev/null 2>&1 \
    || die "EventBridge connection $CONNECTION_NAME not found"
  info "order: Vercel first, redeploy, then EventBridge, so at most one 5-min check gets a 401"
  confirm "Rotate CRON_SECRET in Vercel production and EventBridge?"

  local value
  value=$(new_secret)
  update_vercel_secret CRON_SECRET "$value"
  redeploy_production

  step "Update EventBridge connection"
  if ! $APPLY; then
    would "update $CONNECTION_NAME's Authorization header to 'Bearer <new secret>'"
    would "check that an unauthenticated GET /api/cron/check-status returns 401"
    would "watch CloudWatch for the next $RULE_NAME run and fail on FailedInvocations"
    return
  fi
  local body since code
  body=$(secret_tmp)
  NEW_VALUE="Bearer $value" jq -n --arg name "$CONNECTION_NAME" \
    '{Name: $name, AuthorizationType: "API_KEY",
      AuthParameters: {ApiKeyAuthParameters: {ApiKeyName: "Authorization", ApiKeyValue: env.NEW_VALUE}}}' >"$body"
  aws events update-connection --cli-input-json "file://$body" >/dev/null
  since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  info "updated $CONNECTION_NAME"

  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/api/cron/check-status")
  [ "$code" = "401" ] || warn "unauthenticated check-status returned $code, expected 401"
  verify_cron_invocations "$since"
  info "Development CRON_SECRET left unchanged. If you ever re-run setup-eventbridge-cron.sh, it reads"
  info "CRON_SECRET from .env.local, so it would need the production value, not the dev one."
}

# ---------- connected services ----------

service_keys() {
  case "$1" in
    resend) echo "RESEND_API_KEY" ;;
    blob) echo "BLOB_READ_WRITE_TOKEN" ;;
    upstash) echo "KV_REST_API_TOKEN KV_REST_API_READ_ONLY_TOKEN KV_URL REDIS_URL" ;;
    neon) echo "DATABASE_URL DATABASE_URL_UNPOOLED POSTGRES_PASSWORD PGPASSWORD POSTGRES_URL POSTGRES_URL_NO_SSL POSTGRES_URL_NON_POOLING POSTGRES_PRISMA_URL NEON_AUTH_BASE_URL" ;;
    *) return 1 ;;
  esac
}

service_instructions() {
  local team_slug="$1"
  case "$2" in
    blob)
      echo "https://vercel.com/$team_slug/csp-status-hub/settings/environment-variables"
      echo "Hover the 'Needs Attention' badge on BLOB_READ_WRITE_TOKEN and click 'Rotate Blob Credentials'." ;;
    *)
      echo "https://vercel.com/$team_slug/~/integrations"
      echo "Open the $2 integration → Settings → Secure This Resource → Rotate Secrets." ;;
  esac
}

rotate_service() {
  local svc="$1" keys primary team_slug before after url how
  keys=$(service_keys "$svc")
  primary=${keys%% *}
  step "Rotate $svc ($keys)"
  case "$svc" in
    neon | upstash)
      warn "the old credential stops working the moment you click, so DB/Redis requests fail until the"
      warn "redeploy finishes (about a minute; one 5-min status check may be missed)" ;;
  esac
  load_envs
  team_slug=$(vapi "/v2/teams/$TEAM_ID" | jq -r '.slug // empty')
  [ -n "$team_slug" ] || die "could not look up the team slug"
  url=$(service_instructions "$team_slug" "$svc" | sed -n 1p)
  how=$(service_instructions "$team_slug" "$svc" | sed -n 2p)
  before=$(prod_updated_at "$primary")

  if ! $APPLY; then
    would "open $url"
    would "wait for you to: $how"
    would "confirm $primary's updatedAt changed from $before"
  else
    confirm "Start the $svc rotation now?"
    info "opening $url"
    command -v open >/dev/null && open "$url"
    info "$how"
    printf '  Press Enter once the rotation has finished... '
    read -r _
    for _ in $(seq 1 12); do
      load_envs
      after=$(prod_updated_at "$primary")
      [ "$after" != "$before" ] && break
      sleep 10
    done
    if [ "$after" = "$before" ]; then
      warn "$primary's updatedAt didn't change, so the rotation may not have happened"
      confirm "Redeploy anyway?"
    else
      info "$primary updated in Vercel"
    fi
  fi

  redeploy_production
  pull_env_local
  credential_check "$svc"
  if [ "$svc" = "neon" ]; then
    step "Production check (neon)"
    if $APPLY; then
      local code
      code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE_URL/api/incidents/history?_=$(date +%s)")
      [ "$code" = "200" ] || die "/api/incidents/history returned $code"
      info "/api/incidents/history returned 200"
    else
      would "check $SITE_URL/api/incidents/history returns 200"
    fi
  fi

  if $SECURE_AFTER; then
    secure "$svc"
  else
    info "next: --secure $svc to clear the Needs Attention badges"
  fi
}

# ---------- secure (split into Sensitive prod/preview + readable dev) ----------

secure_key() {
  local key="$1" records count rec id type targets has_dev keep
  records=$(jq -c --arg k "$key" '[.envs[] | select(.key == $k)]' <<<"$ENV_JSON")
  count=$(jq length <<<"$records")
  [ "$count" -gt 0 ] || { warn "$key: not found, skipping"; return; }
  rec=$(jq -c '[.[] | select(.target | index("production"))][0] // empty' <<<"$records")
  [ -n "$rec" ] || { warn "$key: no production copy, skipping"; return; }
  type=$(jq -r .type <<<"$rec")
  if [ "$type" = "sensitive" ]; then
    info "$key: production copy already Sensitive"
    return
  fi
  id=$(jq -r .id <<<"$rec")
  targets=$(jq -c .target <<<"$rec")
  has_dev=$(jq -r '.target | index("development") != null' <<<"$rec")
  keep=$(jq -c '[.target[] | select(. != "development")]' <<<"$rec")

  if ! $APPLY; then
    would "change $key from $targets ($type) to $keep Sensitive$([ "$has_dev" = true ] && echo ", plus a readable [\"development\"] copy")"
    return
  fi

  # Read the value once, before it becomes write-only, and build both bodies.
  local current patch post
  current=$(secret_tmp)
  patch=$(secret_tmp)
  post=$(secret_tmp)
  vapi "/v1/projects/$PROJECT_ID/env/$id" >"$current"
  [ "$(jq -r .decrypted "$current")" = "true" ] || die "$key: Vercel didn't return a decrypted value"
  jq --argjson t "$keep" '{type: "sensitive", target: $t, value: .value}' "$current" >"$patch"
  jq '{key: .key, value: .value, type: "encrypted", target: ["development"]}' "$current" >"$post"

  vapi "/v9/projects/$PROJECT_ID/env/$id" -X PATCH --input "$patch" >/dev/null \
    || die "$key: Vercel refused the change (service-owned variables may not allow it); nothing was changed"
  info "$key: $keep now Sensitive"
  if [ "$has_dev" = true ]; then
    vapi "/v10/projects/$PROJECT_ID/env" -X POST --input "$post" >/dev/null \
      || die "$key: couldn't add the Development copy; re-add it from .env.local with: vercel env add $key development"
    info "$key: readable Development copy added"
  fi
}

secure() {
  local what="$1" keys k
  step "Secure $what"
  if keys=$(service_keys "$what"); then :; else keys="$what"; fi
  load_envs
  local n
  n=$(wc -w <<<"$keys" | tr -d ' ')
  confirm "Make $n variable(s) Sensitive for Production + Preview?"
  for k in $keys; do secure_key "$k"; done
  if $APPLY; then
    load_envs
    info "remaining flags: $(jq -r '[.envs[] | select((.securityIssues // []) | length > 0) | .key] | unique | join(", ") | if . == "" then "none" else . end' <<<"$ENV_JSON")"
  fi
}

# ---------- main ----------

while [ $# -gt 0 ]; do
  case "$1" in
    --audit) MODE=audit ;;
    --rotate) MODE=rotate; TARGET="${2:-}"; shift ;;
    --secure)
      if [ "$MODE" = "rotate" ] || [[ "${2:-}" == --* ]] || [ -z "${2:-}" ]; then
        SECURE_AFTER=true
      else
        MODE=secure; TARGET="$2"; shift
      fi ;;
    --max-age) MAX_AGE_DAYS="${2:-}"; shift ;;
    --apply) APPLY=true ;;
    --yes | -y) ASSUME_YES=true ;;
    --dry-run) APPLY=false ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "unknown option: $1" ;;
  esac
  shift
done

[ -n "$MODE" ] || { usage; exit 1; }
[[ "$MAX_AGE_DAYS" =~ ^[0-9]+$ ]] || die "--max-age needs a number of days"

step "Prerequisites"
for bin in vercel jq curl openssl node; do
  command -v "$bin" >/dev/null || die "$bin not found"
done
vercel whoami >/dev/null 2>&1 || die "Vercel CLI not logged in (run: vercel login)"
info "vercel, jq, curl, openssl, node found; Vercel CLI logged in"
if $APPLY; then
  info "mode: APPLY (changes will be made)"
else
  info "mode: dry run (no changes; add --apply to make them)"
fi

case "$MODE" in
  # run_audit returns 1 when something needs attention, which exits via set -e
  audit) run_audit; exit 0 ;;
  secure)
    [ -n "$TARGET" ] || die "--secure needs a service or KEY"
    secure "$TARGET" ;;
  rotate)
    case "$TARGET" in
      cron) rotate_cron ;;
      session) rotate_session ;;
      resend | blob | upstash | neon) rotate_service "$TARGET" ;;
      *) die "--rotate needs one of: cron, session, resend, blob, upstash, neon" ;;
    esac
    if $SECURE_AFTER && { [ "$TARGET" = cron ] || [ "$TARGET" = session ]; }; then
      info "--secure ignored: $TARGET is already Sensitive in production"
    fi ;;
esac

echo
if $APPLY; then
  echo "Done."
else
  echo "Dry run complete. Nothing was changed. Re-run with --apply to make these changes."
fi
