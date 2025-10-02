#!/bin/bash
# Bootstrap PubSub topics and subscriptions for local development

set -e

# Default to local emulator (host perspective)
export PUBSUB_EMULATOR_HOST=${PUBSUB_EMULATOR_HOST:-localhost:8085}
PROJECT_ID=${PROJECT_ID:-local-dev}

echo "🚀 Setting up PubSub topics and subscriptions..."
echo "Using emulator: $PUBSUB_EMULATOR_HOST"
echo "Project ID: $PROJECT_ID"

# Wait for emulator to be ready
echo "⏳ Waiting for PubSub emulator..."
until curl -s http://pubsub-emulator:8085 > /dev/null 2>&1; do
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

echo "📫 Creating subscription for activity aggregator"
curl -X PUT "http://pubsub-emulator:8085/v1/projects/$PROJECT_ID/subscriptions/desirelines_aggregator_subscription" \
    -H "Content-Type: application/json" \
    -d '{
        "topic": "projects/'$PROJECT_ID'/topics/'$TOPIC_NAME'",
        "pushConfig": {
            "pushEndpoint": "http://activity-aggregator:8080"
        }
    }'

echo "📫 Creating subscription for BQ inserter"
curl -X PUT "http://pubsub-emulator:8085/v1/projects/$PROJECT_ID/subscriptions/desirelines_bq_inserter_subscription" \
    -H "Content-Type: application/json" \
    -d '{
        "topic": "projects/'$PROJECT_ID'/topics/'$TOPIC_NAME'",
        "pushConfig": {
            "pushEndpoint": "http://activity-bq-inserter:8080"
        }
    }'

echo "✅ PubSub setup complete!"
echo ""
echo "📋 Summary:"
echo "  Topic: $TOPIC_NAME"
echo "  Topic Path: projects/$PROJECT_ID/topics/$TOPIC_NAME"
echo "  Subscriptions:"
echo "    - desirelines_aggregator_subscription → http://activity-aggregator:8080"
echo "    - desirelines_bq_inserter_subscription → http://activity-bq-inserter:8080"
echo ""
echo "🔧 Make sure your docker-compose environment contains:"
echo "  GCP_PUBSUB_TOPIC=$TOPIC_NAME"
echo "  GCP_PROJECT_ID=$PROJECT_ID"
