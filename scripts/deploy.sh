#!/bin/bash
set -e

TMPFILE=$(mktemp)

# Run vercel, show output in real time, and capture it
vercel "$@" 2>&1 | tee "$TMPFILE"

# Prefer the aliased domain (e.g. cloudstatus.synepho.com) over the raw
# deployment URL; fall back to the deployment URL if no alias was printed
# (e.g. preview deploys).
ALIAS_URL=$(grep -oE 'Aliased: +https://[^ ]+' "$TMPFILE" | grep -oE 'https://[^ ]+' | tail -1)
DEPLOY_URL=$(grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' "$TMPFILE" | tail -1)
URL="${ALIAS_URL:-$DEPLOY_URL}"
rm -f "$TMPFILE"

if [ -n "$URL" ]; then
  echo ""
  echo "Opening $URL..."
  open "$URL"
fi
