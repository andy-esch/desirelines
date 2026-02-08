# Dispatcher (Go)

Receives Strava webhook events, enriches CREATE events with activity data from the Strava API, and publishes enriched events to PubSub for downstream processing.

## Architecture

```
Strava Webhook → Dispatcher (Cloud Run) → [enrich with Strava API] → PubSub Topic → Eventarc → downstream services
```

The dispatcher is the **only service** that calls the Strava API. Downstream consumers (bq-inserter, postgres-writer) receive enriched events with activity data inline and do not need Strava API credentials.

**Package Structure (Hexagonal Architecture):**

```
packages/dispatcher/
├── cmd/dispatcher/main.go       # HTTP server entrypoint
├── adapters/
│   ├── http/handler.go          # HTTP handler (inbound adapter)
│   ├── pubsub/publisher.go      # PubSub publishing (outbound adapter)
│   ├── strava/client.go         # Strava API client (outbound adapter)
│   ├── proto/webhook_adapter.go # JSON ↔ protobuf conversion
│   └── env/secrets.go           # Environment/secrets adapter
├── ports/interfaces.go          # Port interfaces (Publisher, SecretProvider, StravaClient)
├── types/generated/webhook.pb.go # Generated protobuf types
├── config/config.go             # Configuration loading
└── Dockerfile                   # Cloud Run container
```

**Type Definitions:** Webhook types are defined in `schemas/proto/webhook.proto` and shared with stravapipe (Python). Generated code lives in `types/generated/`. See `just proto-gen-backend`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/webhook` | Strava subscription verification (hub.mode, hub.challenge, hub.verify_token) |
| `POST` | `/webhook` | Receive Strava webhook events |
| `GET` | `/health` | Health check endpoint |
| `HEAD` | `/` | Health probe for Cloud Run |

**Note:** The Strava webhook callback URL must include the `/webhook` path (e.g., `https://your-service.run.app/webhook`).

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

### Strava API Secrets

The dispatcher enriches CREATE events by fetching activity data from the Strava API. Credentials are loaded from secret file mounts (preferred) with environment variable fallback:

| Secret Mount | Env Var Fallback | Description |
|-------------|------------------|-------------|
| `/etc/secrets/INFISICAL_STRAVA_CLIENT_ID/value` | `STRAVA_CLIENT_ID` | Strava API app client ID |
| `/etc/secrets/INFISICAL_STRAVA_CLIENT_SECRET/value` | `STRAVA_CLIENT_SECRET` | Strava API app client secret |
| `/etc/secrets/INFISICAL_STRAVA_REFRESH_TOKEN/value` | `STRAVA_REFRESH_TOKEN` | OAuth refresh token |

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

# Deploy by merging to main (triggers CI → deploy repo)
# Or manually from desirelines-deploy repo
```

See [Docker Guide](../../docs/guides/docker.md) and [Deployment Guide](../../docs/guides/deployment.md).

## Package Documentation

Each package has GoDoc documentation viewable via `go doc`:

| Package | Description |
|---------|-------------|
| [ports](./ports/) | Port interfaces (Publisher, SecretProvider, StravaClient) |
| [adapters/http](./adapters/http/) | HTTP webhook handler |
| [adapters/pubsub](./adapters/pubsub/) | Google Cloud Pub/Sub adapter |
| [adapters/strava](./adapters/strava/) | Strava API client (token management, activity fetch) |
| [adapters/env](./adapters/env/) | Secrets loading with caching |
| [adapters/proto](./adapters/proto/) | JSON ↔ protobuf conversion |
| [config](./config/) | Configuration loading |

Logging uses the shared [gcplog](../shared/gcplog/) package.
