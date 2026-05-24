#!/bin/bash
# Bootstrap PubSub topics and subscriptions for local development

set -euo pipefail

# Default to local emulator (host perspective)
export PUBSUB_EMULATOR_HOST=${PUBSUB_EMULATOR_HOST:-localhost:8085}
PROJECT_ID=${PROJECT_ID:-local-dev}

echo "🚀 Setting up PubSub topics and subscriptions..."
echo "Using emulator: $PUBSUB_EMULATOR_HOST"
echo "Project ID: $PROJECT_ID"

# Wait for emulator to be ready
echo "⏳ Waiting for PubSub emulator..."
until curl -s http://pubsub-emulator:8085 >/dev/null 2>&1; do
	echo "  Still waiting for emulator..."
	sleep 2
done
echo "✅ PubSub emulator is ready"

# Topic name from your config
TOPIC_NAME=${TOPIC_NAME:-desirelines_activity_events}

# Use the PubSub emulator's REST API directly
echo "📢 Creating topic: $TOPIC_NAME using REST API"
curl -X PUT "http://pubsub-emulator:8085/v1/projects/$PROJECT_ID/topics/$TOPIC_NAME" \
	-H "Content-Type: application/json" \
	-d '{}'

# Push subscriptions route through the CloudEvent adapter, which wraps
# PubSub emulator messages with Eventarc-style CloudEvent headers (ce-type,
# ce-id, ce-source, ce-time) before forwarding to the target services.

echo "📫 Creating subscription for BQ inserter (via CloudEvent adapter)"
curl -X PUT "http://pubsub-emulator:8085/v1/projects/$PROJECT_ID/subscriptions/desirelines_bq_inserter_subscription" \
	-H "Content-Type: application/json" \
	-d '{
        "topic": "projects/'"$PROJECT_ID"'/topics/'"$TOPIC_NAME"'",
        "pushConfig": {
            "pushEndpoint": "http://cloudevent-adapter:8080/bq-inserter"
        }
    }'

echo "📫 Creating subscription for PostgreSQL writer (via CloudEvent adapter)"
curl -X PUT "http://pubsub-emulator:8085/v1/projects/$PROJECT_ID/subscriptions/desirelines_postgres_writer_subscription" \
	-H "Content-Type: application/json" \
	-d '{
        "topic": "projects/'"$PROJECT_ID"'/topics/'"$TOPIC_NAME"'",
        "pushConfig": {
            "pushEndpoint": "http://cloudevent-adapter:8080/postgres-writer"
        }
    }'

echo "✅ PubSub setup complete!"
echo ""
echo "📋 Summary:"
echo "  Topic: $TOPIC_NAME"
echo "  Topic Path: projects/$PROJECT_ID/topics/$TOPIC_NAME"
echo "  Subscriptions (via CloudEvent adapter):"
echo "    - desirelines_bq_inserter_subscription → cloudevent-adapter → bq-inserter"
echo "    - desirelines_postgres_writer_subscription → cloudevent-adapter → postgres-writer"
echo ""
echo "🔧 The CloudEvent adapter wraps PubSub messages with Eventarc-style headers"
echo "   (ce-type, ce-id, ce-source, ce-time) to match production behavior."
