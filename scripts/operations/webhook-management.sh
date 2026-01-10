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
GCP_PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
REGION="us-central1"

if [ -z "$GCP_PROJECT_ID" ]; then
	echo "❌ Error: No GCP project set in gcloud config"
	echo "Run: gcloud config set project YOUR_PROJECT_ID"
	exit 1
fi

# Safety check: verify project matches requested environment
EXPECTED_PROJECT="desirelines-${ENV_NAME}"
if [ "$GCP_PROJECT_ID" != "$EXPECTED_PROJECT" ]; then
	echo "❌ Error: Project mismatch!"
	echo "   Requested environment: $ENV_NAME"
	echo "   Expected project:      $EXPECTED_PROJECT"
	echo "   Current project:       $GCP_PROJECT_ID"
	echo ""
	echo "Run: gcloud config set project $EXPECTED_PROJECT"
	exit 1
fi
echo "✅ Project verified: $GCP_PROJECT_ID"

# Helper function for confirmation prompt
confirm_action() {
	local action="$1"
	local details="$2"
	echo ""
	echo "⚠️  $action"
	echo "$details"
	echo ""
	read -p "Continue? (y/N): " -r </dev/tty
	echo ""
	if [[ ! $REPLY =~ ^[Yy]$ ]]; then
		echo "❌ Operation cancelled"
		exit 1
	fi
}

case "$COMMAND" in
"create")
	echo ""
	echo "🔗 Creating Strava webhook subscription"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

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

	BASE_URL=$(gcloud run services describe "$SERVICE_NAME" \
		--region=$REGION \
		--project="$GCP_PROJECT_ID" \
		--format="value(status.url)")
	CALLBACK_URL="${BASE_URL}/webhook"

	STRAVA_AUTH=$(gcloud secrets versions access latest --secret="strava-auth" --project="$GCP_PROJECT_ID")
	CLIENT_ID=$(echo "$STRAVA_AUTH" | jq -r '.client_id')
	CLIENT_SECRET=$(echo "$STRAVA_AUTH" | jq -r '.client_secret')
	VERIFY_TOKEN=$(echo "$STRAVA_AUTH" | jq -r '.webhook_verify_token')

	echo "   Environment:  $ENV_NAME"
	echo "   Project:      $GCP_PROJECT_ID"
	echo "   Dispatcher:   $SERVICE_NAME"
	echo "   Callback URL: $CALLBACK_URL"
	echo "   Client ID:    $CLIENT_ID"

	confirm_action \
		"This will register a new webhook subscription with Strava." \
		"   Strava will send all activity events to the callback URL."

	echo "Creating webhook subscription..."
	curl -s -X POST \
		https://www.strava.com/api/v3/push_subscriptions \
		-F client_id="$CLIENT_ID" \
		-F client_secret="$CLIENT_SECRET" \
		-F callback_url="$CALLBACK_URL" \
		-F verify_token="$VERIFY_TOKEN" | jq .
	;;

"view")
	echo ""
	echo "🔍 Viewing Strava webhook subscriptions"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "   Environment: $ENV_NAME"
	echo "   Project:     $GCP_PROJECT_ID"
	echo ""

	STRAVA_AUTH=$(gcloud secrets versions access latest --secret="strava-auth" --project="$GCP_PROJECT_ID")
	CLIENT_ID=$(echo "$STRAVA_AUTH" | jq -r '.client_id')
	CLIENT_SECRET=$(echo "$STRAVA_AUTH" | jq -r '.client_secret')

	curl -sG \
		-d client_id="$CLIENT_ID" \
		-d client_secret="$CLIENT_SECRET" \
		https://www.strava.com/api/v3/push_subscriptions | jq .
	;;

"delete")
	echo ""
	echo "🗑️  Deleting Strava webhook subscription"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

	STRAVA_AUTH=$(gcloud secrets versions access latest --secret="strava-auth" --project="$GCP_PROJECT_ID")
	SUBSCRIPTION_ID=$(echo "$STRAVA_AUTH" | jq -r '.webhook_subscription_id')
	CLIENT_ID=$(echo "$STRAVA_AUTH" | jq -r '.client_id')
	CLIENT_SECRET=$(echo "$STRAVA_AUTH" | jq -r '.client_secret')

	echo "   Environment:     $ENV_NAME"
	echo "   Project:         $GCP_PROJECT_ID"
	echo "   Subscription ID: $SUBSCRIPTION_ID"
	echo "   Client ID:       $CLIENT_ID"

	confirm_action \
		"This will DELETE the webhook subscription from Strava." \
		"   You will stop receiving activity events until you create a new subscription."

	echo "Deleting webhook subscription..."
	curl -s -X DELETE \
		"https://www.strava.com/api/v3/push_subscriptions/$SUBSCRIPTION_ID?client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET" | jq .
	;;

"generate-token")
	echo ""
	echo "🔐 Generating webhook verify token"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "   Environment: $ENV_NAME"
	echo "   Project:     $GCP_PROJECT_ID"
	echo ""

	VERIFY_TOKEN=$(openssl rand -hex 32)
	echo "Generated token: ${VERIFY_TOKEN:0:8}... (truncated for security)"

	if gcloud secrets describe strava-webhook-verify-token --project="$GCP_PROJECT_ID" >/dev/null 2>&1; then
		echo "Secret exists, adding new version..."
		echo -n "$VERIFY_TOKEN" | gcloud secrets versions add strava-webhook-verify-token \
			--project="$GCP_PROJECT_ID" \
			--data-file=-
	else
		echo "Creating new secret..."
		echo -n "$VERIFY_TOKEN" | gcloud secrets create strava-webhook-verify-token \
			--project="$GCP_PROJECT_ID" \
			--data-file=-
	fi

	echo ""
	echo "✅ Webhook verify token stored in Secret Manager"
	;;

"rotate-token")
	echo ""
	echo "🔄 Rotating webhook verify token"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "   Environment: $ENV_NAME"
	echo "   Project:     $GCP_PROJECT_ID"

	confirm_action \
		"This will rotate the webhook verify token in Secret Manager." \
		"   After rotation, you MUST:
   1. Redeploy dispatcher to pick up new token
   2. Delete old webhook subscription
   3. Create new webhook subscription"

	VERIFY_TOKEN=$(openssl rand -hex 32)
	echo "Generated new token: ${VERIFY_TOKEN:0:8}..."

	echo -n "$VERIFY_TOKEN" | gcloud secrets versions add strava-webhook-verify-token \
		--project="$GCP_PROJECT_ID" \
		--data-file=-

	echo ""
	echo "✅ Token rotated successfully!"
	echo ""
	echo "📋 Next steps:"
	echo "   1. Redeploy dispatcher to pick up new token"
	echo "   2. Delete old subscription: $0 delete $ENV_NAME"
	echo "   3. Create new subscription: $0 create $ENV_NAME"
	;;

*)
	echo "❌ Error: Unknown command '$COMMAND'"
	echo "Available commands: create, view, delete, generate-token, rotate-token"
	exit 1
	;;
esac
