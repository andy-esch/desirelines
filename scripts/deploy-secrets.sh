#!/bin/bash

# Deploy secrets with proper IAM bindings for environment
# Usage: ./scripts/deploy-secrets.sh <secret-file>
# Example: ./scripts/deploy-secrets.sh strava-auth.json
# Environment is detected from current gcloud project

set -euo pipefail

# Check arguments
if [ $# -ne 1 ]; then
    echo "❌ Error: Please specify secret file"
    echo "Usage: $0 <secret-file>"
    echo "Example: $0 strava-auth.json"
    echo "Environment will be detected from current gcloud project"
    exit 1
fi

SECRET_FILE="$1"

# Get GCP project ID and detect environment
GCP_PROJECT_ID=$(gcloud config get-value project)
if [ "$GCP_PROJECT_ID" = "desirelines-dev" ]; then
    ENV_NAME="dev"
elif [ "$GCP_PROJECT_ID" = "desirelines-prod" ]; then
    ENV_NAME="prod"
else
    echo "❌ Error: Invalid GCP project for desirelines!"
    echo "   Current:  $GCP_PROJECT_ID"
    echo "   Expected: desirelines-dev or desirelines-prod"
    echo "   Run: gcloud config set project desirelines-dev"
    echo "   Or:  gcloud config set project desirelines-prod"
    exit 1
fi

# Check if secret file exists
if [ ! -f "$SECRET_FILE" ]; then
    echo "❌ Error: Secret file $SECRET_FILE does not exist"
    exit 1
fi

echo "🔐 Deploying secrets for $ENV_NAME environment from $SECRET_FILE..."
echo "📍 Using GCP project: $GCP_PROJECT_ID"
echo "🎯 Environment: $ENV_NAME (detected from project)"
echo ""

# Confirmation dialog
echo "⚠️  This will deploy/update secrets in the $ENV_NAME environment."
echo "   Secret: strava-auth-$ENV_NAME"
echo "   Project: $GCP_PROJECT_ID"
echo ""
read -p "Continue? (y/N): " -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi
echo ""

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

echo "✅ Secret strava-auth-$ENV_NAME deployed with content"
echo "ℹ️  IAM permissions will be managed by Terraform during infrastructure deployment"
