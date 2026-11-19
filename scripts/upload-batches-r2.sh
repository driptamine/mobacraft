#!/usr/bin/env bash
# Publish assembled runtime models and hero portraits. Source exports stay local.
# Required env matches upload-models-r2.sh. Extra args go to aws s3 sync.
set -euo pipefail

: "${R2_BUCKET_NAME:?Set R2_BUCKET_NAME}"
: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID}"
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY}"

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true
S3_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# Restore match startup first; heroes remain lazy-loaded on selection.
aws s3 sync batches/creeps-lane/final/ "s3://${R2_BUCKET_NAME}/batches/creeps-lane/final/" \
  --endpoint-url "$S3_ENDPOINT" --exclude '*' --include '*.glb' \
  --content-type model/gltf-binary --no-progress "$@"

aws s3 sync batches/ "s3://${R2_BUCKET_NAME}/batches/" \
  --endpoint-url "$S3_ENDPOINT" --exclude '*' --include '[0-9]*/final/*.glb' \
  --content-type model/gltf-binary --no-progress "$@"

for portraits in assets/batch1 assets/heroes; do
  aws s3 sync "$portraits/" "s3://${R2_BUCKET_NAME}/${portraits}/" \
    --endpoint-url "$S3_ENDPOINT" --exclude '*' --include '*.png' \
    --content-type image/png --no-progress "$@"
done
