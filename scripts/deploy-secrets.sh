#!/bin/bash

# Deploy secrets with proper IAM bindings for environment
# Usage: ./scripts/deploy-secrets.sh <environment> <secret-file>
# Example: ./scripts/deploy-secrets.sh dev strava-auth-dev.json

set -euo pipefail

# Check arguments
if [ $# -ne 2 ]; then
    echo "❌ Error: Please specify environment and file"
    echo "Usage: $0 <environment> <secret-file>"
    echo "Example: $0 dev strava-auth-dev.json"
    exit 1
fi

ENV_NAME="$1"
SECRET_FILE="$2"

# Validate environment
if [[ ! "$ENV_NAME" =~ ^(dev|prod)$ ]]; then
    echo "❌ Error: Environment must be 'dev' or 'prod'"
    exit 1
fi

# Check if secret file exists
if [ ! -f "$SECRET_FILE" ]; then
    echo "❌ Error: Secret file $SECRET_FILE does not exist"
    exit 1
fi

# Get GCP project ID from gcloud config
GCP_PROJECT_ID=$(gcloud config get-value project)
if [ -z "$GCP_PROJECT_ID" ]; then
    echo "❌ Error: No GCP project set in gcloud config"
    echo "Run: gcloud config set project YOUR_PROJECT_ID"
    exit 1
fi

echo "🔐 Deploying secrets for $ENV_NAME environment from $SECRET_FILE..."
echo "📍 Using GCP project: $GCP_PROJECT_ID"

# Ensure Secret Manager API is enabled
echo "🔧 Ensuring Secret Manager API is enabled..."
gcloud services enable secretmanager.googleapis.com --project="$GCP_PROJECT_ID"

# Create or update secret
echo "📋 Creating strava-auth-$ENV_NAME secret..."
if gcloud secrets describe "strava-auth-$ENV_NAME" --project="$GCP_PROJECT_ID" 2>/dev/null; then
    echo "  Secret already exists, adding new version..."
else
    echo "  Creating new secret..."
    gcloud secrets create "strava-auth-$ENV_NAME" --project="$GCP_PROJECT_ID"
fi

echo "📝 Adding secret version from $SECRET_FILE..."
gcloud secrets versions add "strava-auth-$ENV_NAME" \
    --project="$GCP_PROJECT_ID" \
    --data-file="$SECRET_FILE"

echo "🔑 Granting secret access to service accounts..."

# Grant access to terraform service account
gcloud secrets add-iam-policy-binding "strava-auth-$ENV_NAME" \
    --project="$GCP_PROJECT_ID" \
    --member="serviceAccount:terraform-desirelines-$ENV_NAME@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding "strava-auth-$ENV_NAME" \
    --project="$GCP_PROJECT_ID" \
    --member="serviceAccount:terraform-desirelines-$ENV_NAME@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretVersionManager"

gcloud secrets add-iam-policy-binding "strava-auth-$ENV_NAME" \
    --project="$GCP_PROJECT_ID" \
    --member="serviceAccount:terraform-desirelines-$ENV_NAME@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.admin"

# Grant access to function service accounts
for FUNCTION in dispatcher aggregator bq-inserter; do
    echo "   Granting access to $FUNCTION-$ENV_NAME service account..."
    gcloud secrets add-iam-policy-binding "strava-auth-$ENV_NAME" \
        --project="$GCP_PROJECT_ID" \
        --member="serviceAccount:$FUNCTION-$ENV_NAME@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
        --role="roles/secretmanager.secretAccessor"
done

echo "✅ Secret strava-auth-$ENV_NAME deployed with content and proper IAM bindings"
