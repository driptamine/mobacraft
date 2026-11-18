#!/usr/bin/env bash
# Upload the runtime map files to the matching maps/ prefix in the R2 bucket.
# Only what the game loads: .sgb, .json, .png, manifest.json. Source-only bulk
# (all_tiles/, *.tga, *.dds — the game reads PNGs converted from them) stays out.
# Rebuilds maps/manifest.json first so the uploaded list matches the upload.
# Environment and authentication match upload-assets-r2.sh.
# Extra arguments are passed to aws s3 sync (for example --dryrun).
set -euo pipefail

: "${R2_BUCKET_NAME:?Set R2_BUCKET_NAME (see .env.example)}"
: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID (see .env.example)}"
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID (see .env.example)}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY (see .env.example)}"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true

S3_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

node --import tsx scripts/build-maps-manifest.mjs

aws s3 sync maps/ "s3://${R2_BUCKET_NAME}/maps/" \
  --endpoint-url "$S3_ENDPOINT" \
  --region auto \
  --exclude '.*' \
  --exclude '*/.*' \
  --exclude 'all_tiles/*' \
  --exclude '*.tga' \
  --exclude '*.dds' \
  "$@"
