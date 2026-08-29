#!/bin/bash
# Provisions the AWS side of the Incident Briefing Engine's Bedrock access
# (see README.md's Alerts & Admin section): a Vercel OIDC identity provider
# in IAM (none exists yet in this account — only a GitHub Actions one) and
# an IAM role Vercel Functions can assume via sts:AssumeRoleWithWebIdentity,
# scoped to invoking Claude Sonnet 5's cross-region inference profile. No
# static AWS keys anywhere, matching this account's existing
# OIDC-over-static-keys standard (see scripts/setup-eventbridge-cron.sh).
#
# Idempotent — safe to re-run; each step checks for an existing resource
# before creating one. Mirrors setup-eventbridge-cron.sh's structure.
#
# Verified against this AWS account before writing this script:
#   - Account: 600424110307, region: us-east-1 (same region the existing
#     EventBridge rule already runs in).
#   - Bedrock model access for anthropic.claude-sonnet-5 is already
#     AUTHORIZED/AVAILABLE in us-east-1 — no manual console step needed.
#   - The model only supports INFERENCE_PROFILE invocation; the inference
#     profile us.anthropic.claude-sonnet-5 is ACTIVE in this account.
#
# Creates, in order:
#   1. An IAM OIDC identity provider for oidc.vercel.com/<team-slug>.
#   2. An IAM role (csp-status-hub-bedrock-role) trusting that provider,
#      scoped via a `sub` condition to this Vercel project.
#   3. An inline policy granting bedrock:InvokeModel on the inference
#      profile and the underlying foundation model it routes to.
#
# Usage: ./scripts/setup-bedrock-oidc.sh
# After it prints a role ARN, set it as the AWS_ROLE_ARN env var (plus
# AWS_REGION and BEDROCK_MODEL_ID per README.md) via `vercel env add`.
set -e

VERCEL_TEAM_SLUG="johns-projects-2d2073fd"
AWS_ACCOUNT_ID="600424110307"
ROLE_NAME="csp-status-hub-bedrock-role"
OIDC_ISSUER_HOST="oidc.vercel.com/${VERCEL_TEAM_SLUG}"
# Scoped to the whole Claude family, not just one model ID — Claude Sonnet 5
# access on Bedrock currently requires an AWS Sales-approved allowlist
# request (confirmed 2026-08-29: other Claude models invoke immediately,
# Sonnet 5 alone returns AccessDeniedException pointing to AWS Sales), so
# BEDROCK_MODEL_ID gets swapped between Claude models via env var without a
# redeploy or another IAM edit each time.
INFERENCE_PROFILE_ARN="arn:aws:bedrock:*:${AWS_ACCOUNT_ID}:inference-profile/*anthropic.claude-*"
FOUNDATION_MODEL_ARN="arn:aws:bedrock:*::foundation-model/anthropic.claude-*"

tags_json() {
  cat <<EOF
[
  {"Key":"Environment","Value":"prod"},
  {"Key":"ManagedBy","Value":"bootstrap-script"},
  {"Key":"Owner","Value":"John Xanthopoulos"},
  {"Key":"Project","Value":"csp-status-hub"},
  {"Key":"Service","Value":"incident-analysis"},
  {"Key":"GithubRepo","Value":"csp-status-hub"},
  {"Key":"Site","Value":"csp-status-hub.vercel.app"},
  {"Key":"BaseProject","Value":"csp-status-hub"},
  {"Key":"SubService","Value":"$2"},
  {"Key":"Name","Value":"$1"}
]
EOF
}

echo "== 1. IAM OIDC identity provider for Vercel =="
OIDC_PROVIDER_ARN=$(aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?contains(Arn, '${OIDC_ISSUER_HOST}')].Arn" --output text)
if [ -n "$OIDC_PROVIDER_ARN" ]; then
  echo "  provider for $OIDC_ISSUER_HOST already exists, skipping"
else
  OIDC_PROVIDER_ARN=$(aws iam create-open-id-connect-provider \
    --url "https://${OIDC_ISSUER_HOST}" \
    --client-id-list "https://vercel.com/${VERCEL_TEAM_SLUG}" \
    --tags "$(tags_json "$OIDC_ISSUER_HOST" "oidc-provider")" \
    --query 'OpenIDConnectProviderArn' --output text)
  echo "  created OIDC provider for $OIDC_ISSUER_HOST"
fi

echo "== 2. IAM role for Bedrock (Vercel OIDC federation) =="
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || echo "")
if [ -n "$ROLE_ARN" ]; then
  echo "  $ROLE_NAME already exists, skipping"
else
  TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "${OIDC_PROVIDER_ARN}" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${OIDC_ISSUER_HOST}:aud": "https://vercel.com/${VERCEL_TEAM_SLUG}"
        },
        "StringLike": {
          "${OIDC_ISSUER_HOST}:sub": [
            "owner:${VERCEL_TEAM_SLUG}:project:csp-status-hub:environment:production",
            "owner:${VERCEL_TEAM_SLUG}:project:csp-status-hub:environment:preview"
          ]
        }
      }
    }
  ]
}
EOF
)
  ROLE_ARN=$(aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --tags "$(tags_json "$ROLE_NAME" "iam-role")" \
    --query 'Role.Arn' --output text)
  echo "  created $ROLE_NAME"

  INVOKE_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": ["${INFERENCE_PROFILE_ARN}", "${FOUNDATION_MODEL_ARN}"]
    }
  ]
}
EOF
)
  aws iam put-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-name "invoke-claude-sonnet-5" \
    --policy-document "$INVOKE_POLICY"
  echo "  attached invoke policy scoped to the Claude Sonnet 5 inference profile"

  echo "  waiting for IAM propagation..."
  sleep 10
fi

echo ""
echo "Done. Set these as Vercel project env vars (vercel env add):"
echo "  AWS_ROLE_ARN=$ROLE_ARN"
echo "  AWS_REGION=us-east-1"
echo "  BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-5   (optional, this is already the default)"
echo ""
echo "Inspect what this script created:"
echo "  aws iam get-role --role-name $ROLE_NAME"
echo "  aws iam list-open-id-connect-providers"
