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

# Create access key
echo "=== Creating access key ==="
CREDS=$(aws iam create-access-key --user-name "${IAM_USER}" --output json)

ACCESS_KEY=$(echo "${CREDS}" | python3 -c "import sys,json; print(json.load(sys.stdin)['AccessKey']['AccessKeyId'])")
SECRET_KEY=$(echo "${CREDS}" | python3 -c "import sys,json; print(json.load(sys.stdin)['AccessKey']['SecretAccessKey'])")

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
