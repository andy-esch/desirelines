# Strava Webhook Dispatcher (Go)

Receives Strava webhook events and forwards them to PubSub for downstream processing by the Aggregator and BQ Inserter applications. This Go Cloud package, when run as a Cloud Function, provides fast cold starts (~100ms) and low memory usage for the desirelines fitness data pipeline.

## 🏗️ Architecture

**Package Structure:**

```text
packages/dispatcher/     # Go package with business logic
├── handler.go          # HTTP handler implementation
├── webhook.go          # Webhook validation and processing
├── publisher.go        # PubSub message publishing
└── cmd/local/          # Local development server

functions/activity_dispatcher/  # Cloud Function thin wrapper
├── main.go             # Exports ActivityDispatcher() function
└── go.mod              # Imports packages/dispatcher
```

**Deployment Model:**
This Go package is packaged into Cloud Functions via a build script, unlike the cleaner Python package approach used elsewhere. The `functions/activity_dispatcher/` directory contains a thin wrapper that imports this package.

## 🚀 Features

- **Fast cold starts** (~100ms vs Python's 1-2s)
- **Low memory footprint** (~10-20MB vs Python's 50-100MB)
- **Webhook validation**: Strava signature and subscription ID verification
- **PubSub publishing**: Reliable event forwarding to downstream functions
- **Dual deployment**: Local development server + Google Cloud Functions
- **Secret volume support**: Dynamic loading from `/etc/secrets/strava_auth.json`

## Environment Variables

Required environment variables:

```bash
STRAVA_WEBHOOK_VERIFY_TOKEN=your_verify_token
STRAVA_WEBHOOK_SUBSCRIPTION_ID=123456
GCP_PROJECT_ID=your-project-id
GCP_PUBSUB_TOPIC=your-topic-name
```

Optional:

```bash
LOG_LEVEL=INFO  # Default: INFO
PORT=8080       # Default: 8080
```

## 💻 Development

### Prerequisites

- Go 1.25 or later
- Google Cloud credentials configured

### Local Development Mode

Automatically detects local environment and starts HTTP server:

```bash
cd packages/dispatcher
go mod download

# Copy and configure environment variables
cp .env.example .env
# Edit .env - set GCP_PROJECT_ID=local-dev to match docker-compose

# From the root directory (maybe in a separate terminal), start PubSub emulator:
docker compose up pubsub-emulator pubsub-bootstrap -d

# Run local development server with emulator
PUBSUB_EMULATOR_HOST=localhost:8085 GCP_PUBSUB_TOPIC=strava-webhooks STRAVA_WEBHOOK_SUBSCRIPTION_ID=123456 GCP_PROJECT_ID=local-dev go run ./cmd/local
```

### Testing Cloud Function Wrapper

Test the actual cloud function:

```bash
cd ../../functions/activity_dispatcher
go run .
```

**Note:** The local development server (`cmd/local`) may behave differently than the actual cloud function wrapper. For production-like testing, use the cloud function wrapper above.

### Testing Endpoints

**Webhook verification:**

```bash
curl "http://localhost:8080/?hub.mode=subscribe&hub.challenge=test123&hub.verify_token=your_verify_token"
```

**Webhook event:**

```bash
curl -X POST http://localhost:8080/ \
  -H "Content-Type: application/json" \
  -d '{
    "aspect_type": "create",
    "event_time": 1234567890,
    "object_id": 12345,
    "object_type": "activity",
    "owner_id": 67890,
    "subscription_id": 123456,
    "updates": {}
  }'
```

## 🌩️ Cloud Deployment

Deploy to Google Cloud Functions:

```bash
gcloud functions deploy activity-dispatcher \
  --runtime go125 \
  --trigger-http \
  --entry-point ActivityDispatcher \
  --env-vars-file .env.yaml \
  --source=.
```
