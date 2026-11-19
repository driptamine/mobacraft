#!/usr/bin/env bash
# Item catalog is bundled by Vite; only the extracted official PNGs use R2.
set -euo pipefail
: "${R2_BUCKET_NAME:?Set R2_BUCKET_NAME}"
: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
aws s3 sync assets/items/ "s3://${R2_BUCKET_NAME}/assets/items/" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --exclude '*' --include '*.png' --content-type image/png --no-progress "$@"
