#!/bin/bash

# Deploy secrets with proper IAM bindings for environment
# Usage: ./scripts/deploy-secrets.sh <secret-type> [secret-file|connection-string]
#
# Examples:
#   ./scripts/deploy-secrets.sh strava strava-auth.json
#   ./scripts/deploy-secrets.sh postgres "postgres://user:pass@host/db"
#   echo "connection-string" | ./scripts/deploy-secrets.sh postgres -
#
# Environment is detected from current gcloud project

set -euo pipefail

# Check arguments
if [ $# -lt 1 ]; then
	echo "❌ Error: Please specify secret type"
	echo "Usage: $0 <secret-type> [secret-file|connection-string]"
	echo ""
	echo "Secret types:"
	echo "  strava   - Strava API credentials (requires file)"
	echo "  postgres - PostgreSQL connection string (file or stdin)"
	echo ""
	echo "Examples:"
	echo "  $0 strava strava-auth.json"
	echo "  $0 postgres \"postgres://user:pass@host/db\""
	echo "  echo \"connection-string\" | $0 postgres -"
	echo ""
	echo "Environment will be detected from current gcloud project"
	exit 1
fi

SECRET_TYPE="$1"
SECRET_INPUT="${2:-}"

# Validate secret type
case "$SECRET_TYPE" in
strava)
	SECRET_NAME="strava-auth"
	if [ -z "$SECRET_INPUT" ]; then
		echo "❌ Error: Strava secrets require a file path"
		echo "Usage: $0 strava <secret-file>"
		echo "Example: $0 strava strava-auth.json"
		exit 1
	fi
	;;
postgres)
	SECRET_NAME="postgres-connection-string"
	;;
*)
	echo "❌ Error: Unknown secret type: $SECRET_TYPE"
	echo "Valid types: strava, postgres"
	exit 1
	;;
esac

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

# Prepare data source based on secret type and input
if [ "$SECRET_TYPE" = "strava" ]; then
	# Strava: file-based input
	if [ ! -f "$SECRET_INPUT" ]; then
		echo "❌ Error: Secret file $SECRET_INPUT does not exist"
		exit 1
	fi
	DATA_SOURCE="file"
	DATA_FILE="$SECRET_INPUT"
	INPUT_DESC="from $SECRET_INPUT"
elif [ "$SECRET_TYPE" = "postgres" ]; then
	# Postgres: string or stdin
	if [ -z "$SECRET_INPUT" ] || [ "$SECRET_INPUT" = "-" ]; then
		# Read from stdin
		DATA_SOURCE="stdin"
		INPUT_DESC="from stdin"
	else
		# Direct string input - create temp file
		DATA_SOURCE="string"
		DATA_FILE=$(mktemp)
		echo -n "$SECRET_INPUT" >"$DATA_FILE"
		INPUT_DESC="from provided string"
		trap "rm -f '$DATA_FILE'" EXIT
	fi
fi

# Secret names don't need environment suffix - each GCP project is already env-specific
FULL_SECRET_NAME="${SECRET_NAME}"

echo "🔐 Deploying $SECRET_TYPE secret for $ENV_NAME environment $INPUT_DESC..."
echo "📍 Using GCP project: $GCP_PROJECT_ID"
echo "🎯 Environment: $ENV_NAME (detected from project)"
echo "🔑 Secret name: $FULL_SECRET_NAME"
echo ""

# Confirmation dialog
echo "⚠️  This will deploy/update secrets in the $ENV_NAME environment."
echo "   Secret: $FULL_SECRET_NAME"
echo "   Project: $GCP_PROJECT_ID"
echo "   Type: $SECRET_TYPE"
echo ""
read -p "Continue? (y/N): " -r </dev/tty
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
echo "📋 Creating $FULL_SECRET_NAME secret..."
if gcloud secrets describe "$FULL_SECRET_NAME" --project="$GCP_PROJECT_ID" 2>/dev/null; then
	echo "  Secret already exists, adding new version..."
else
	echo "  Creating new secret..."
	gcloud secrets create "$FULL_SECRET_NAME" \
		--project="$GCP_PROJECT_ID" \
		--replication-policy=automatic
fi

# Add secret version based on data source
echo "📝 Adding secret version..."
if [ "$DATA_SOURCE" = "stdin" ]; then
	# Read from stdin
	gcloud secrets versions add "$FULL_SECRET_NAME" \
		--project="$GCP_PROJECT_ID" \
		--data-file=-
elif [ "$DATA_SOURCE" = "file" ] || [ "$DATA_SOURCE" = "string" ]; then
	# Read from file (or temp file created from string)
	gcloud secrets versions add "$FULL_SECRET_NAME" \
		--project="$GCP_PROJECT_ID" \
		--data-file="$DATA_FILE"
fi

echo "✅ Secret $FULL_SECRET_NAME deployed successfully"
echo "ℹ️  IAM permissions will be managed by Terraform during infrastructure deployment"
