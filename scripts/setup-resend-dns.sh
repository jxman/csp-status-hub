#!/bin/bash
# Adds the DNS records Resend requires to verify alerts.synepho.com for sending
# email from csp-status-hub, plus a DMARC record (not required by Resend to
# verify the domain, but required by Google/Yahoo/Microsoft's bulk-sender
# rules — Resend's dashboard flags it as "needs attention" without one; added
# 2026-09-22, p=none since this is a monitor-only starting policy).
# Idempotent (UPSERT) — safe to re-run.
#
# Source of truth for the MX/SPF/DKIM values: `curl -H "Authorization: Bearer
# $RESEND_API_KEY" https://api.resend.com/domains/<domain-id>` (see README.md's
# Alerts & Admin section). Re-run that lookup if Resend ever rotates the DKIM key.
# The DMARC record isn't Resend-issued — it's this project's own policy.
set -e

HOSTED_ZONE_ID="Z1YCOPGKIGNAB3"   # synepho.com
DOMAIN="alerts.synepho.com"

DKIM_VALUE="p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCsL0vaqPKhjh37K8BIgpDZBm/gjqnDAjNL9OQspDDRMgpKSkV6+5VmmieofcrKiOtsvgjtMio9ERrr5wkfNWPIv3G43rha+Da4o1xNZMRIwRoMivquoELel7fsFtD6nkYlPH/3ueTbvgXqhhN+fuUuHjTM4ogZxybddmI8xGJg5QIDAQAB"

CHANGE_BATCH=$(cat <<EOF
{
  "Comment": "Resend domain verification for ${DOMAIN}",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "send.${DOMAIN}",
        "Type": "MX",
        "TTL": 300,
        "ResourceRecords": [
          { "Value": "10 feedback-smtp.us-east-1.amazonses.com" }
        ]
      }
    },
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "send.${DOMAIN}",
        "Type": "TXT",
        "TTL": 300,
        "ResourceRecords": [
          { "Value": "\"v=spf1 include:amazonses.com ~all\"" }
        ]
      }
    },
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "resend._domainkey.${DOMAIN}",
        "Type": "TXT",
        "TTL": 300,
        "ResourceRecords": [
          { "Value": "\"${DKIM_VALUE}\"" }
        ]
      }
    },
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "_dmarc.${DOMAIN}",
        "Type": "TXT",
        "TTL": 300,
        "ResourceRecords": [
          { "Value": "\"v=DMARC1; p=none; adkim=r; aspf=r\"" }
        ]
      }
    }
  ]
}
EOF
)

aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "$CHANGE_BATCH"

echo ""
echo "Submitted. DNS propagation is usually fast but can take up to ~15 min."
echo "Verify in Resend once propagated:"
echo "  curl -X POST -H \"Authorization: Bearer \$RESEND_API_KEY\" \\"
echo "    https://api.resend.com/domains/bfcf07e7-1590-445d-ad3c-ebf59390ccf9/verify"
