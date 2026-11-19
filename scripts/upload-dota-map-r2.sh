#!/usr/bin/env bash
# Upload the Skirmish copy and map list; the port-40002 export stays local.
set -euo pipefail
: "${R2_BUCKET_NAME:?Set R2_BUCKET_NAME}"
: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
node scripts/build-maps-manifest.mjs

aws s3 sync maps/dotamap-game/ "s3://${R2_BUCKET_NAME}/maps/dotamap-game/" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --exclude '*' --include 'map.glb' --include 'map.json' --include 'surface.json' --include 'preview.png' \
  --no-progress "$@"

aws s3 cp maps/manifest.json "s3://${R2_BUCKET_NAME}/maps/manifest.json" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --content-type application/json --cache-control no-cache --no-progress "$@"
