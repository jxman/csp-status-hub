#!/bin/bash
set -e

TMPFILE=$(mktemp)

# Run vercel, show output in real time, and capture it
vercel "$@" 2>&1 | tee "$TMPFILE"

# Extract the deployed URL and open it
URL=$(grep -oE 'https://[a-zA-Z0-9._-]+\.vercel\.app' "$TMPFILE" | tail -1)
rm -f "$TMPFILE"

if [ -n "$URL" ]; then
  echo ""
  echo "Opening $URL..."
  open "$URL"
fi
