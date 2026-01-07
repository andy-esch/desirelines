#!/bin/bash

# Strava webhook management script
# Usage: ./scripts/webhook-management.sh <command> <environment>
# Commands: create, view, delete, generate-token, rotate-token
# Example: ./scripts/webhook-management.sh create dev

set -euo pipefail

# Check arguments
if [ $# -ne 2 ]; then
	echo "❌ Error: Please specify command and environment"
	echo "Usage: $0 <command> <environment>"
	echo "Commands: create, view, delete, generate-token, rotate-token"
	echo "Example: $0 create dev"
	exit 1
fi

COMMAND="$1"
ENV_NAME="$2"

# Validate environment
if [[ ! "$ENV_NAME" =~ ^(dev|prod)$ ]]; then
	echo "❌ Error: Environment must be 'dev' or 'prod'"
	exit 1
fi

# Get GCP project configuration
GCP_PROJECT_ID=$(gcloud config get-value project)
REGION="us-central1"

if [ -z "$GCP_PROJECT_ID" ]; then
	echo "❌ Error: No GCP project set in gcloud config"
	echo "Run: gcloud config set project YOUR_PROJECT_ID"
	exit 1
fi

case "$COMMAND" in
"create")
	echo "🔗 Creating Strava webhook subscription for $ENV_NAME environment..."

	# Get Cloud Run dispatcher URL
	SERVICE_NAME=$(gcloud run services list \
		--region=$REGION \
		--filter="metadata.name~dispatcher" \
		--format="value(metadata.name)" \
		--project="$GCP_PROJECT_ID" 2>/dev/null | head -1)

	if [ -z "$SERVICE_NAME" ]; then
		echo "❌ Error: Could not find dispatcher Cloud Run service in $REGION"
		echo "Make sure the service is deployed and region is correct"
		exit 1
	fi

	CALLBACK_URL=$(gcloud run services describe "$SERVICE_NAME" \
		--region=$REGION \
		--project="$GCP_PROJECT_ID" \
		--format="value(status.url)")
	echo "📍 Found dispatcher: $SERVICE_NAME"
	echo "📍 Callback URL: $CALLBACK_URL"

	STRAVA_AUTH=$(gcloud secrets versions access latest --secret="strava-auth" --project="$GCP_PROJECT_ID")
	CLIENT_ID=$(echo "$STRAVA_AUTH" | jq -r '.client_id')
	CLIENT_SECRET=$(echo "$STRAVA_AUTH" | jq -r '.client_secret')
	VERIFY_TOKEN=$(echo "$STRAVA_AUTH" | jq -r '.webhook_verify_token')

	echo ""
	echo "Creating webhook subscription..."
	curl -X POST \
		https://www.strava.com/api/v3/push_subscriptions \
		-F client_id="$CLIENT_ID" \
		-F client_secret="$CLIENT_SECRET" \
		-F callback_url="$CALLBACK_URL" \
		-F verify_token="$VERIFY_TOKEN"
	echo ""
	;;

"view")
	echo "🔍 Viewing Strava webhook subscriptions for $ENV_NAME environment..."

	STRAVA_AUTH=$(gcloud secrets versions access latest --secret="strava-auth" --project="$GCP_PROJECT_ID")
	CLIENT_ID=$(echo "$STRAVA_AUTH" | jq -r '.client_id')
	CLIENT_SECRET=$(echo "$STRAVA_AUTH" | jq -r '.client_secret')

	curl -sG \
		-d client_id="$CLIENT_ID" \
		-d client_secret="$CLIENT_SECRET" \
		https://www.strava.com/api/v3/push_subscriptions
	;;

"delete")
	echo "🗑️ Deleting Strava webhook subscription for $ENV_NAME environment..."

	STRAVA_AUTH=$(gcloud secrets versions access latest --secret="strava-auth" --project="$GCP_PROJECT_ID")
	SUBSCRIPTION_ID=$(echo "$STRAVA_AUTH" | jq -r '.webhook_subscription_id')
	CLIENT_ID=$(echo "$STRAVA_AUTH" | jq -r '.client_id')
	CLIENT_SECRET=$(echo "$STRAVA_AUTH" | jq -r '.client_secret')

	curl -X DELETE \
		"https://www.strava.com/api/v3/push_subscriptions/$SUBSCRIPTION_ID?client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET"
	;;

"generate-token")
	echo "🔐 Generating secure webhook verify token..."

	VERIFY_TOKEN=$(openssl rand -hex 32)
	echo "Generated token: $VERIFY_TOKEN"

	if gcloud secrets describe strava-webhook-verify-token --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
		echo "  Secret exists, adding new version..."
		echo -n "$VERIFY_TOKEN" | gcloud secrets versions add strava-webhook-verify-token \
			--project="$GCP_PROJECT_ID" \
			--data-file=-
	else
		echo "  Creating new secret..."
		echo -n "$VERIFY_TOKEN" | gcloud secrets create strava-webhook-verify-token \
			--project="$GCP_PROJECT_ID" \
			--data-file=-
	fi

	echo "✅ Webhook verify token stored in Secret Manager"
	;;

"rotate-token")
	echo "🔄 Rotating webhook verify token..."

	VERIFY_TOKEN=$(openssl rand -hex 32)
	echo "New token: $VERIFY_TOKEN"

	echo -n "$VERIFY_TOKEN" | gcloud secrets versions add strava-webhook-verify-token \
		--project="$GCP_PROJECT_ID" \
		--data-file=-

	echo "📋 Token rotated. You'll need to:"
	echo "  1. Redeploy dispatcher to pick up new token"
	echo "  2. Delete old webhook subscription: $0 delete $ENV_NAME"
	echo "  3. Create new webhook subscription: $0 create $ENV_NAME"
	echo "✅ Webhook verify token rotation complete!"
	;;

*)
	echo "❌ Error: Unknown command '$COMMAND'"
	echo "Available commands: create, view, delete, generate-token, rotate-token"
	exit 1
	;;
esac
