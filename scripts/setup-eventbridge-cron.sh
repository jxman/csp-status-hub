#!/bin/bash
# Provisions AWS EventBridge to hit /api/cron/check-status every 5 minutes,
# working around Vercel Hobby's once-per-day native cron cap (see
# ALERTS-DESIGN.md Section 7.3 for why). Idempotent — safe to re-run; each
# step checks for an existing resource before creating one.
#
# Uses classic EventBridge Rules + Targets, not the newer EventBridge
# Scheduler service — Scheduler's `create-schedule` rejects an API
# Destination ARN as a Target.Arn outright (ValidationException). Rules are
# the mature, documented mechanism for API Destination targets (see
# `aws events put-targets help` — HttpParameters explicitly references
# "EventBridge ApiDestination") and support tagging natively, so there's no
# need for the schedule-group-as-tagging-workaround an earlier attempt at
# this used.
#
# Creates, in order:
#   1. An EventBridge Connection — stores CRON_SECRET as an API-key header.
#   2. An EventBridge API Destination — the HTTPS target.
#   3. An IAM role EventBridge assumes to invoke that API Destination.
#   4. A tagged EventBridge Rule on a rate(5 minutes) schedule.
#   5. A Target on that rule pointing at the API Destination.
#
# All resources share the "csp-status-hub" name prefix — that's the single
# place to look (`aws events describe-rule --name csp-status-hub-check-status`
# and friends) to find everything this script created.
#
# Usage: set -a; source .env.local; set +a; ./scripts/setup-eventbridge-cron.sh
set -e

CONNECTION_NAME="csp-status-hub-cron-connection"
API_DESTINATION_NAME="csp-status-hub-check-status"
ROLE_NAME="csp-status-hub-eventbridge-role"
RULE_NAME="csp-status-hub-check-status"
TARGET_ENDPOINT="https://cloudstatus.synepho.com/api/cron/check-status"

if [ -z "$CRON_SECRET" ]; then
  echo "CRON_SECRET is not set. Run: set -a; source .env.local; set +a" >&2
  exit 1
fi

tags_json() {
  cat <<EOF
[
  {"Key":"Environment","Value":"prod"},
  {"Key":"ManagedBy","Value":"bootstrap-script"},
  {"Key":"Owner","Value":"John Xanthopoulos"},
  {"Key":"Project","Value":"csp-status-hub"},
  {"Key":"Service","Value":"alerting"},
  {"Key":"GithubRepo","Value":"csp-status-hub"},
  {"Key":"Site","Value":"csp-status-hub.vercel.app"},
  {"Key":"BaseProject","Value":"csp-status-hub"},
  {"Key":"SubService","Value":"eventbridge-rule"},
  {"Key":"Name","Value":"$1"}
]
EOF
}

echo "== 0. Clean up the orphaned Scheduler group from the earlier failed attempt =="
if aws scheduler get-schedule-group --name "csp-status-hub" >/dev/null 2>&1; then
  aws scheduler delete-schedule-group --name "csp-status-hub" >/dev/null
  echo "  deleted leftover 'csp-status-hub' schedule group (Scheduler's create-schedule doesn't support API Destination targets — using Rules instead)"
else
  echo "  nothing to clean up"
fi

echo "== 1. EventBridge connection =="
CONNECTION_ARN=$(aws events describe-connection --name "$CONNECTION_NAME" --query 'ConnectionArn' --output text 2>/dev/null || echo "")
if [ -n "$CONNECTION_ARN" ]; then
  echo "  $CONNECTION_NAME already exists, skipping"
else
  AUTH_PARAMS=$(cat <<EOF
{"ApiKeyAuthParameters":{"ApiKeyName":"Authorization","ApiKeyValue":"Bearer $CRON_SECRET"}}
EOF
)
  CONNECTION_ARN=$(aws events create-connection \
    --name "$CONNECTION_NAME" \
    --authorization-type API_KEY \
    --auth-parameters "$AUTH_PARAMS" \
    --query 'ConnectionArn' --output text)
  echo "  created $CONNECTION_NAME"
fi

echo "== 2. EventBridge API destination =="
API_DESTINATION_ARN=$(aws events describe-api-destination --name "$API_DESTINATION_NAME" --query 'ApiDestinationArn' --output text 2>/dev/null || echo "")
if [ -n "$API_DESTINATION_ARN" ]; then
  CURRENT_ENDPOINT=$(aws events describe-api-destination --name "$API_DESTINATION_NAME" --query 'InvocationEndpoint' --output text)
  if [ "$CURRENT_ENDPOINT" != "$TARGET_ENDPOINT" ]; then
    echo "  $API_DESTINATION_NAME exists but points at $CURRENT_ENDPOINT, updating to $TARGET_ENDPOINT"
    aws events update-api-destination \
      --name "$API_DESTINATION_NAME" \
      --connection-arn "$CONNECTION_ARN" \
      --invocation-endpoint "$TARGET_ENDPOINT" \
      --http-method GET \
      --invocation-rate-limit-per-second 1 >/dev/null
  else
    echo "  $API_DESTINATION_NAME already exists and endpoint is current, skipping"
  fi
else
  API_DESTINATION_ARN=$(aws events create-api-destination \
    --name "$API_DESTINATION_NAME" \
    --connection-arn "$CONNECTION_ARN" \
    --invocation-endpoint "$TARGET_ENDPOINT" \
    --http-method GET \
    --invocation-rate-limit-per-second 1 \
    --query 'ApiDestinationArn' --output text)
  echo "  created $API_DESTINATION_NAME"
fi

echo "== 3. IAM role for EventBridge =="
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "")
if [ -n "$ROLE_ARN" ]; then
  echo "  $ROLE_NAME already exists, skipping"
else
  TRUST_POLICY=$(cat <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Principal": {"Service": "events.amazonaws.com"}, "Action": "sts:AssumeRole" }
  ]
}
EOF
)
  ROLE_ARN=$(aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --tags "$(tags_json "$ROLE_NAME")" \
    --query 'Role.Arn' --output text)
  echo "  created $ROLE_NAME"

  INVOKE_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "events:InvokeApiDestination", "Resource": "$API_DESTINATION_ARN" }
  ]
}
EOF
)
  aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "invoke-check-status-api-destination" \
    --policy-document "$INVOKE_POLICY"
  echo "  attached invoke policy scoped to $API_DESTINATION_NAME"

  echo "  waiting for IAM propagation..."
  sleep 10
fi

echo "== 4. EventBridge rule (rate(5 minutes)) =="
if aws events describe-rule --name "$RULE_NAME" >/dev/null 2>&1; then
  echo "  $RULE_NAME already exists, skipping"
else
  aws events put-rule \
    --name "$RULE_NAME" \
    --schedule-expression "rate(5 minutes)" \
    --state ENABLED \
    --tags "$(tags_json "$RULE_NAME")" >/dev/null
  echo "  created $RULE_NAME"
fi

echo "== 5. Rule target (the API destination) =="
EXISTING_TARGET=$(aws events list-targets-by-rule --rule "$RULE_NAME" --query 'Targets[0].Id' --output text 2>/dev/null || echo "None")
if [ "$EXISTING_TARGET" != "None" ] && [ -n "$EXISTING_TARGET" ]; then
  echo "  target already attached, skipping"
else
  aws events put-targets \
    --rule "$RULE_NAME" \
    --targets "Id=check-status,Arn=$API_DESTINATION_ARN,RoleArn=$ROLE_ARN" >/dev/null
  echo "  attached target to $RULE_NAME"
fi

echo ""
echo "Done. Every resource shares the 'csp-status-hub' prefix — single install location:"
echo "  aws events describe-rule --name $RULE_NAME"
echo "  aws events list-targets-by-rule --rule $RULE_NAME"
echo "  aws events describe-api-destination --name $API_DESTINATION_NAME"
echo "  aws events describe-connection --name $CONNECTION_NAME"
echo "  aws iam get-role --role-name $ROLE_NAME"
echo ""
echo "Check will fire within 5 minutes. Watch results in Vercel function logs for /api/cron/check-status."
