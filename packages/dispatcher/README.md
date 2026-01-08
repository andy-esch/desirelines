# Dispatcher (Go)

Receives Strava webhook events and publishes to PubSub for downstream processing.

## Architecture

```
Strava Webhook → Dispatcher (Cloud Run) → PubSub Topic → Eventarc → downstream services
```

**Package Structure (Hexagonal Architecture):**

```
packages/dispatcher/
├── cmd/dispatcher/main.go       # HTTP server entrypoint
├── adapters/
│   ├── http/handler.go          # HTTP handler (inbound adapter)
│   ├── pubsub/publisher.go      # PubSub publishing (outbound adapter)
│   ├── proto/webhook_adapter.go # JSON ↔ protobuf conversion
│   └── env/secrets.go           # Environment/secrets adapter
├── ports/interfaces.go          # Port interfaces (Publisher, SecretProvider)
├── types/generated/webhook.pb.go # Generated protobuf types
├── config/config.go             # Configuration loading
├── middleware/logger.go         # HTTP middleware
├── pkg/                         # Shared utilities
│   ├── apierrors/               # API error handling
│   └── logger/                  # Structured logging
└── Dockerfile                   # Cloud Run container
```

**Type Definitions:** Webhook types are defined in `schemas/proto/webhook.proto` and shared with stravapipe (Python) via protobuf code generation. See `make proto-gen-go-dispatcher`.

## Environment Variables

```bash
# Required
GCP_PROJECT_ID=desirelines-dev
GCP_PUBSUB_TOPIC=desirelines_activity_events
STRAVA_WEBHOOK_SUBSCRIPTION_ID=123456

# Optional
LOG_LEVEL=INFO   # Default: INFO
PORT=8080        # Default: 8080 (Cloud Run sets this)
```

## Development

### Local with docker-compose

```bash
# Start backend (includes PubSub emulator)
docker compose --profile backend up

# Test webhook
curl -X POST http://localhost:8081/webhook \
  -H "Content-Type: application/json" \
  -d '{"aspect_type":"create","event_time":1234567890,"object_id":12345,"object_type":"activity","owner_id":67890,"subscription_id":123456}'
```

### Standalone

```bash
cd packages/dispatcher

# Start PubSub emulator
docker compose up pubsub-emulator pubsub-bootstrap -d

# Run dispatcher
PUBSUB_EMULATOR_HOST=localhost:8085 \
GCP_PROJECT_ID=local-dev \
GCP_PUBSUB_TOPIC=desirelines_activity_events \
STRAVA_WEBHOOK_SUBSCRIPTION_ID=123456 \
go run ./cmd/dispatcher
```

### Tests

```bash
go test ./...
```

## Deployment

Built and deployed via Pants:

```bash
# Build and publish
GIT_COMMIT=$(git rev-parse --short HEAD) pants publish packages/dispatcher:dispatcher

# Deploy via Terraform
cd terraform/environments/dev
terraform apply -var="deployment_version=$(git rev-parse --short HEAD)"
```

See [Docker Guide](../../docs/guides/docker.md) and [Deployment Guide](../../docs/guides/deployment.md).
