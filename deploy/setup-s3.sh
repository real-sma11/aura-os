#!/bin/bash
#
# Create and configure the AURA S3 bucket for file uploads and generated assets.
# Run this once to set up the bucket, then use the output env vars on Render.
#
# Prerequisites:
#   - AWS CLI installed (brew install awscli)
#   - AWS credentials exported (from AWS SSO portal → dev-aura-swarm → Access keys)
#
# Usage:
#   chmod +x deploy/setup-s3.sh
#   ./deploy/setup-s3.sh

set -euo pipefail

BUCKET_NAME="aura-asi-production-assets"
REGION="us-east-1"

echo "=== Creating S3 bucket: ${BUCKET_NAME} in ${REGION} ==="

# Create bucket
aws s3api create-bucket \
  --bucket "${BUCKET_NAME}" \
  --region "${REGION}" \
  2>/dev/null || echo "Bucket may already exist, continuing..."

# Disable block public access (needed for public read)
echo "=== Configuring public access ==="
aws s3api put-public-access-block \
  --bucket "${BUCKET_NAME}" \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# Set bucket policy for public read
echo "=== Setting bucket policy (public read) ==="
aws s3api put-bucket-policy \
  --bucket "${BUCKET_NAME}" \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "PublicReadGetObject",
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::'"${BUCKET_NAME}"'/*"
      }
    ]
  }'

# Set CORS configuration
echo "=== Setting CORS configuration ==="
aws s3api put-bucket-cors \
  --bucket "${BUCKET_NAME}" \
  --cors-configuration '{
    "CORSRules": [
      {
        "AllowedHeaders": ["Content-Type", "Content-Length"],
        "AllowedMethods": ["PUT"],
        "AllowedOrigins": [
          "https://app.aura.ai",
          "https://*.aura.ai",
          "http://localhost:5173",
          "http://localhost:3100",
          "http://127.0.0.1:5173",
          "http://127.0.0.1:3100",
          "capacitor://localhost",
          "http://localhost"
        ],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3600
      },
      {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET"],
        "AllowedOrigins": ["*"],
        "MaxAgeSeconds": 86400
      }
    ]
  }'

echo ""
echo "=== S3 bucket setup complete ==="
echo ""
echo "Bucket: ${BUCKET_NAME}"
echo "Region: ${REGION}"
echo "Public URL pattern: https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/{key}"
echo ""
echo "=== Set these env vars on aura-router Render service ==="
echo ""
echo "  S3_BUCKET_NAME=${BUCKET_NAME}"
echo "  AWS_REGION=${REGION}"
echo "  AWS_ACCESS_KEY_ID=<create an IAM user or use SSO credentials>"
echo "  AWS_SECRET_ACCESS_KEY=<matching secret key>"
echo ""
echo "NOTE: For production, create a dedicated IAM user with only S3 access."
echo "Run: ./deploy/create-s3-iam-user.sh to create one."
