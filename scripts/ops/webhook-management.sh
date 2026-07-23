#!/usr/bin/env bash

# Strava webhook management script
# Usage: ./scripts/webhook-management.sh <command> <environment>
# Commands: create, view, delete
# Example: ./scripts/webhook-management.sh create dev
#
# Secrets are managed in Infisical and synced to GCP Secret Manager.
# See docs/guides/secrets.md for details.

set -euo pipefail

# Check arguments
if [ $# -ne 2 ]; then
  echo "❌ Error: Please specify command and environment"
  echo "Usage: $0 <command> <environment>"
  echo "Commands: create, view, delete"
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

# Helper function to read a secret from Secret Manager
read_secret() {
  local secret_name="$1"
  gcloud secrets versions access latest --secret="$secret_name" --project="$GCP_PROJECT_ID" 2>/dev/null
}

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

  # Read individual secrets (synced from Infisical)
  CLIENT_ID=$(read_secret "INFISICAL_STRAVA_CLIENT_ID")
  CLIENT_SECRET=$(read_secret "INFISICAL_STRAVA_CLIENT_SECRET")
  VERIFY_TOKEN=$(read_secret "INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN")

  if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ -z "$VERIFY_TOKEN" ]; then
    echo "❌ Error: Could not read required secrets from Secret Manager"
    echo "   Ensure Infisical sync is configured and secrets exist."
    echo "   See docs/guides/secrets.md for setup instructions."
    exit 1
  fi

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

  CLIENT_ID=$(read_secret "INFISICAL_STRAVA_CLIENT_ID")
  CLIENT_SECRET=$(read_secret "INFISICAL_STRAVA_CLIENT_SECRET")

  if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    echo "❌ Error: Could not read Strava credentials from Secret Manager"
    exit 1
  fi

  curl -sG \
    -d client_id="$CLIENT_ID" \
    -d client_secret="$CLIENT_SECRET" \
    https://www.strava.com/api/v3/push_subscriptions | jq .
  ;;

"delete")
  echo ""
  echo "🗑️  Deleting Strava webhook subscription"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  CLIENT_ID=$(read_secret "INFISICAL_STRAVA_CLIENT_ID")
  CLIENT_SECRET=$(read_secret "INFISICAL_STRAVA_CLIENT_SECRET")
  SUBSCRIPTION_ID=$(read_secret "INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID")

  if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
    echo "❌ Error: Could not read Strava credentials from Secret Manager"
    exit 1
  fi

  if [ -z "$SUBSCRIPTION_ID" ]; then
    echo "❌ Error: No subscription ID found in INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID"
    echo "   You may need to look up the subscription ID manually using 'view' command"
    exit 1
  fi

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

*)
  echo "❌ Error: Unknown command '$COMMAND'"
  echo "Available commands: create, view, delete"
  echo ""
  echo "Note: Token generation/rotation is now managed in Infisical."
  echo "      See docs/guides/secrets.md for details."
  exit 1
  ;;
esac
