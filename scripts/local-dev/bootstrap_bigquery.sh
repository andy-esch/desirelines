#!/bin/bash
set -e

PROJECT_ID=${PROJECT_ID:-"local-dev"}
DATASET_NAME=${DATASET_NAME:-"strava_dev_local"}

echo "🔧 Setting up BigQuery for local development..."
echo "   Project: $PROJECT_ID"
echo "   Dataset: $DATASET_NAME"

# Wait for authentication to be available
echo "⏳ Waiting for authentication..."
until gcloud auth list --filter="status:ACTIVE" --format="value(account)" | head -1; do
  echo "   Waiting for authentication..."
  sleep 2
done

# Create dataset if it doesn't exist
echo "📊 Creating BigQuery dataset: $DATASET_NAME"
if ! bq show --dataset $PROJECT_ID:$DATASET_NAME 2>/dev/null; then
  bq mk --dataset --description "Local development dataset for Strava data" $PROJECT_ID:$DATASET_NAME
  echo "✅ Dataset created: $PROJECT_ID:$DATASET_NAME"
else
  echo "ℹ️  Dataset already exists: $PROJECT_ID:$DATASET_NAME"
fi

# Create activities table
echo "📋 Creating activities table..."
bq mk --table \
  --description "Strava activities for local development" \
  $PROJECT_ID:$DATASET_NAME.activities \
  id:INTEGER,name:STRING,distance_meters:FLOAT,start_time:TIMESTAMP,activity_type:STRING,owner_id:INTEGER

# Create any other tables you need...

echo "🎉 BigQuery setup complete!"
echo "   Dataset: https://console.cloud.google.com/bigquery?project=$PROJECT_ID&d=$DATASET_NAME"
