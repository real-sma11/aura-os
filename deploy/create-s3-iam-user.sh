#!/bin/bash
#
# Create a dedicated IAM user with S3-only access for the aura-router service.
# This is more secure than using SSO credentials (which expire and have broad access).
#
# Usage:
#   chmod +x deploy/create-s3-iam-user.sh
#   ./deploy/create-s3-iam-user.sh

set -euo pipefail

BUCKET_NAME="aura-asi-production-assets"
IAM_USER="aura-router-s3"

echo "=== Verifying AWS credentials ==="
if ! aws sts get-caller-identity --output text >/dev/null 2>&1; then
  echo "ERROR: AWS credentials are missing or invalid." >&2
  echo "Set them in this shell before re-running:" >&2
  echo "  export AWS_ACCESS_KEY_ID=..." >&2
  echo "  export AWS_SECRET_ACCESS_KEY=..." >&2
  echo "  export AWS_SESSION_TOKEN=...   # only for SSO/temporary creds" >&2
  echo "  export AWS_REGION=us-east-1" >&2
  exit 1
fi
aws sts get-caller-identity --output text

echo "=== Creating IAM user: ${IAM_USER} ==="

aws iam create-user --user-name "${IAM_USER}" 2>/dev/null || echo "User may already exist, continuing..."

# Attach inline policy scoped to just this bucket
echo "=== Attaching S3 policy ==="
aws iam put-user-policy \
  --user-name "${IAM_USER}" \
  --policy-name "aura-assets-s3-access" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "AllowS3BucketAccess",
        "Effect": "Allow",
        "Action": [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ],
        "Resource": [
          "arn:aws:s3:::'"${BUCKET_NAME}"'",
          "arn:aws:s3:::'"${BUCKET_NAME}"'/*"
        ]
      }
    ]
  }'

# Create access key. NOTE: each call to create-access-key produces a NEW key,
# and AWS limits each user to 2 active keys, so we must call it once and parse
# both fields from a single response. Use sed (no python3 dependency, works in
# Git Bash on Windows where python3 is often not on PATH).
echo "=== Creating access key ==="
CREDS_FILE=$(mktemp)
trap 'rm -f "${CREDS_FILE}"' EXIT
aws iam create-access-key --user-name "${IAM_USER}" --output json > "${CREDS_FILE}"

ACCESS_KEY=$(sed -nE 's/.*"AccessKeyId"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p'    "${CREDS_FILE}")
SECRET_KEY=$(sed -nE 's/.*"SecretAccessKey"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${CREDS_FILE}")

if [[ -z "${ACCESS_KEY}" || -z "${SECRET_KEY}" ]]; then
  echo "ERROR: failed to parse access key from create-access-key response:" >&2
  cat "${CREDS_FILE}" >&2
  exit 1
fi

echo ""
echo "=== IAM user created ==="
echo ""
echo "=== Set these env vars on aura-router Render service ==="
echo ""
echo "  S3_BUCKET_NAME=${BUCKET_NAME}"
echo "  AWS_REGION=us-east-1"
echo "  AWS_ACCESS_KEY_ID=${ACCESS_KEY}"
echo "  AWS_SECRET_ACCESS_KEY=${SECRET_KEY}"
echo ""
echo "IMPORTANT: Save these credentials now. The secret key cannot be retrieved again."
echo "This IAM user has access ONLY to the ${BUCKET_NAME} bucket."
