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

# shellcheck source=/dev/null  # path is resolved at runtime, not lintable
source "$(dirname "${BASH_SOURCE[0]}")/_gcp_env.sh"

require_env_name "$ENV_NAME"
require_gcp_project "$ENV_NAME"

REGION="us-central1"

# Helper function to read a secret from Secret Manager
read_secret() {
  local secret_name="$1"
  local secret_version="${2:-latest}"
  gcloud secrets versions access "$secret_version" --secret="$secret_name" --project="$GCP_PROJECT_ID" 2>/dev/null
}

# curl's config-file grammar treats quotes, backslashes, and line breaks as
# syntax. Refuse malformed secret values rather than letting them inject a new
# directive into the stdin-only config used by create/view.
validate_curl_config_value() {
  local value_name="$1"
  local value="$2"

  if [[ "$value" == *'"'* || "$value" == *\\* || "$value" == *$'\r'* || "$value" == *$'\n'* ]]; then
    echo "❌ Error: $value_name contains characters that are unsafe for curl configuration"
    exit 1
  fi
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

    SERVICE_JSON=$(gcloud run services describe "$SERVICE_NAME" \
      --region=$REGION \
      --project="$GCP_PROJECT_ID" \
      --format=json)
    BASE_URL=$(printf '%s\n' "$SERVICE_JSON" | jq -er '.status.url')
    CALLBACK_CAPABILITY_VERSION=$(printf '%s\n' "$SERVICE_JSON" | jq -er '
      .spec.template.spec.volumes[]
      | select(.secret.secretName == "INFISICAL_STRAVA_WEBHOOK_CALLBACK_CAPABILITY")
      | .secret.items[]
      | select(.path == "value")
      | .key
    ') || {
      echo "❌ Error: The deployed dispatcher does not mount a callback capability"
      echo "   Deploy dual or capability mode with a pinned numeric secret version first."
      exit 1
    }
    if [[ ! "$CALLBACK_CAPABILITY_VERSION" =~ ^[1-9][0-9]*$ ]]; then
      echo "❌ Error: The deployed callback capability is not pinned to a numeric secret version"
      exit 1
    fi
    # Read individual secrets (synced from Infisical)
    CLIENT_ID=$(read_secret "INFISICAL_STRAVA_CLIENT_ID")
    CLIENT_SECRET=$(read_secret "INFISICAL_STRAVA_CLIENT_SECRET")
    VERIFY_TOKEN=$(read_secret "INFISICAL_STRAVA_WEBHOOK_VERIFY_TOKEN")
    CALLBACK_CAPABILITY=$(read_secret "INFISICAL_STRAVA_WEBHOOK_CALLBACK_CAPABILITY" "$CALLBACK_CAPABILITY_VERSION")

    if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ -z "$VERIFY_TOKEN" ] || [ -z "$CALLBACK_CAPABILITY" ]; then
      echo "❌ Error: Could not read required secrets from Secret Manager"
      echo "   Ensure Infisical sync is configured and secrets exist."
      echo "   See docs/guides/secrets.md for setup instructions."
      exit 1
    fi
    if [[ ! "$CALLBACK_CAPABILITY" =~ ^[0-9a-f]{64}$ ]]; then
      echo "❌ Error: Callback capability must be exactly 64 lowercase hexadecimal characters"
      exit 1
    fi
    validate_curl_config_value "Cloud Run URL" "$BASE_URL"
    validate_curl_config_value "Strava client ID" "$CLIENT_ID"
    validate_curl_config_value "Strava client secret" "$CLIENT_SECRET"
    validate_curl_config_value "Strava verify token" "$VERIFY_TOKEN"
    CALLBACK_URL="${BASE_URL}/webhook/${CALLBACK_CAPABILITY}"

    echo "   Environment:  $ENV_NAME"
    echo "   Project:      $GCP_PROJECT_ID"
    echo "   Dispatcher:   $SERVICE_NAME"
    echo "   Client ID:    $CLIENT_ID"
    echo "   Secret ver:   $CALLBACK_CAPABILITY_VERSION"
    echo "   Callback URL: [redacted capability URL]"

    confirm_action \
      "This will register a new webhook subscription with Strava." \
      "   Strava will send all activity events to the callback URL."

    echo "Creating webhook subscription..."
    # Feed credentials and the bearer callback URL over stdin, never argv.
    # See docs/guides/secure-scripting.md §1 (No Secrets in Args).
    CREATE_STATUS=0
    CREATE_RESPONSE=$(
      curl --config - <<EOF
url = "https://www.strava.com/api/v3/push_subscriptions"
request = "POST"
silent
show-error
fail-with-body
form-string = "client_id=$CLIENT_ID"
form-string = "client_secret=$CLIENT_SECRET"
form-string = "callback_url=$CALLBACK_URL"
form-string = "verify_token=$VERIFY_TOKEN"
EOF
    ) || CREATE_STATUS=$?
    SAFE_CREATE_RESPONSE=${CREATE_RESPONSE//"$CALLBACK_CAPABILITY"/[redacted]}
    if ! printf '%s\n' "$SAFE_CREATE_RESPONSE" | jq .; then
      printf '%s\n' "$SAFE_CREATE_RESPONSE"
    fi
    if [ "$CREATE_STATUS" -ne 0 ]; then
      echo "❌ Strava rejected the subscription (curl exit $CREATE_STATUS)"
      exit "$CREATE_STATUS"
    fi
    if ! CREATED_SUBSCRIPTION_ID=$(printf '%s\n' "$CREATE_RESPONSE" | jq -er '.id | numbers'); then
      echo "❌ Error: Strava response did not contain a numeric subscription ID"
      exit 1
    fi
    echo "✅ Subscription created. Store ID $CREATED_SUBSCRIPTION_ID in INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID before expecting deliveries."
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
    validate_curl_config_value "Strava client ID" "$CLIENT_ID"
    validate_curl_config_value "Strava client secret" "$CLIENT_SECRET"

    # Feed credentials over stdin, never argv. The response is parsed before
    # display so Strava's callback_url bearer credential cannot reach output.
    # See docs/guides/secure-scripting.md §1 (No Secrets in Args).
    VIEW_STATUS=0
    VIEW_RESPONSE=$(
      curl --config - <<EOF
url = "https://www.strava.com/api/v3/push_subscriptions"
get
silent
show-error
fail-with-body
data-urlencode = "client_id=$CLIENT_ID"
data-urlencode = "client_secret=$CLIENT_SECRET"
EOF
    ) || VIEW_STATUS=$?
    if ! printf '%s\n' "$VIEW_RESPONSE" | jq '
      if type == "array" or type == "object" then
        walk(if type == "object" then del(.callback_url) else . end)
      else
        error("unexpected Strava response type")
      end
    '; then
      echo "❌ Error: Refusing to print an unparseable Strava response because it might contain the callback credential"
      exit 1
    fi
    if [ "$VIEW_STATUS" -ne 0 ]; then
      echo "❌ Strava rejected the subscription lookup (curl exit $VIEW_STATUS)"
      exit "$VIEW_STATUS"
    fi
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
    # Feed the request line over stdin, never argv, so the secret is not visible
    # in `ps aux` / /proc/<pid>/cmdline for the life of the call.
    # See docs/guides/secure-scripting.md §1 (No Secrets in Args).
    #
    # PARTIAL FIX — the secret remains in the query string, and therefore in
    # Strava's access logs and any intermediary proxy's. That is not something
    # this script can avoid: Strava's v3 API documents client_id and
    # client_secret as *required query parameters* for DELETE
    # (https://developers.strava.com/docs/webhooks/), with no request-body form.
    # Only the local argv exposure is closed here. Rotate the client secret if
    # you have reason to believe Strava-side logs were exposed.
    DELETE_STATUS=0
    DELETE_RESPONSE=$(
      curl --config - <<EOF
url = "https://www.strava.com/api/v3/push_subscriptions/$SUBSCRIPTION_ID?client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET"
request = "DELETE"
silent
show-error
fail-with-body
EOF
    ) || DELETE_STATUS=$?
    # jq runs on a captured variable rather than in a pipe: piping curl into jq
    # would take jq's exit 0 under `set -o pipefail` semantics and report a
    # Strava rejection as success. A successful DELETE returns an empty body.
    if [ -n "$DELETE_RESPONSE" ] && ! printf '%s\n' "$DELETE_RESPONSE" | jq . 2>/dev/null; then
      printf '%s\n' "$DELETE_RESPONSE"
    fi
    if [ "$DELETE_STATUS" -ne 0 ]; then
      echo "❌ Strava rejected the subscription delete (curl exit $DELETE_STATUS)"
      exit "$DELETE_STATUS"
    fi
    echo "✅ Subscription $SUBSCRIPTION_ID deleted. Clear INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID."
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
