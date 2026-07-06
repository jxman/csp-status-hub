#!/bin/bash
# Adds the DNS records Resend requires to verify alerts.synepho.com for sending
# email from csp-status-hub. Idempotent (UPSERT) — safe to re-run.
#
# Source of truth for these values: `curl -H "Authorization: Bearer $RESEND_API_KEY"
# https://api.resend.com/domains/<domain-id>` (see ALERTS-DESIGN.md Section 8/14.2).
# Re-run that lookup if Resend ever rotates the DKIM key.
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
