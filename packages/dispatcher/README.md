# Strava Webhook Dispatcher (Go)

A Go implementation of the Strava webhook dispatcher using **hexagonal architecture** with ports and adapters pattern.

## 🏗️ Architecture

```
internal/
├── ports/              # Interfaces (WebhookValidator, WebhookPublisher)
├── adapters/           # Technology-specific implementations
│   ├── http/           # HTTPWebhookValidator, HTTPResponseHandler
│   └── pubsub/         # PubSubPublisher
├── application/        # WebhookService business logic
├── domain/            # WebhookRequest models
└── config/            # Configuration management
```

## 🚀 Features

- **Dual deployment modes**: Local development + Google Cloud Functions
- **Hexagonal architecture**: Clean separation of concerns, matches Python packages
- **Fast cold starts** (~100ms vs Python's 1-2s)
- **Low memory footprint** (~10-20MB vs Python's 50-100MB)
- **Webhook validation**: Strava signature and subscription ID verification
- **PubSub publishing**: Reliable event forwarding with retry
- **Correlation tracking**: Full request traceability
- **Technology prefix naming**: Consistent `HTTPWebhookValidator`, `PubSubPublisher` patterns

## Environment Variables

Required environment variables:

```bash
STRAVA_WEBHOOK_VERIFY_TOKEN=your_verify_token
STRAVA_WEBHOOK_SUBSCRIPTION_ID=123456
GCP_PROJECT_ID=your-project-id
GCP_PUBSUB_TOPIC_PATH=projects/your-project-id/topics/your-topic
```

Optional:
```bash
LOG_LEVEL=INFO  # Default: INFO
PORT=8080       # Default: 8080
```

## 💻 Development

### Prerequisites
- Go 1.21 or later
- Google Cloud credentials configured

### Local Development Mode

Automatically detects local environment and starts HTTP server:

```bash
cd packages/dispatcher
go mod download

# Copy environment variables
cp .env.example .env
# Edit .env with your values

# Run locally (automatically detects local mode)
go run .
```

### Cloud Function Mode

Test locally with Functions Framework:

```bash
# Quick test
./test_cloud_function.sh
```

Or manually:
```bash
export FUNCTION_TARGET="ActivityDispatcher"
go run github.com/GoogleCloudPlatform/functions-framework-go/cmd/functions-framework@latest --target=ActivityDispatcher --source=.
```

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
  --runtime go121 \
  --trigger-http \
  --entry-point ActivityDispatcher \
  --env-vars-file .env.yaml \
  --source=.
```

### Build Binary (Optional)

For other deployment targets:

```bash
# Local binary
go build -o dispatcher .

# Linux binary for containers
GOOS=linux GOARCH=amd64 go build -o dispatcher .
```

## Comparison with Python Version

| Metric | Python | Go |
|--------|--------|-----|
| Cold Start | ~1-2s | ~100ms |
| Memory Usage | ~50-100MB | ~10-20MB |
| Dependencies | ~15 packages | 2 packages |
| Binary Size | N/A | ~15MB |
| Lines of Code | 270 | ~220 |

## Migration Notes

This Go implementation provides equivalent functionality to the Python dispatcher:

- ✅ Webhook verification (GET requests)
- ✅ JSON payload validation
- ✅ Subscription ID security checks
- ✅ Correlation ID tracking
- ✅ PubSub publishing with error handling
- ✅ Structured logging
- ✅ Comprehensive error responses

The main differences:
- **Simpler deployment** - single binary vs Python package dependencies
- **Better performance** - faster cold starts and lower memory usage
- **More verbose** - Go requires more explicit error handling
- **Type safety** - Compile-time validation vs runtime validation

## 🧪 Architecture Benefits

- **Testable**: Each hexagonal layer can be unit tested independently
- **Swappable**: Replace PubSub with different message bus without changing business logic
- **Consistent**: Matches Python hexagonal architecture in other packages
- **Clean Dependencies**: Business logic only depends on interfaces, not implementations
- **Technology Agnostic**: Core business logic is independent of HTTP/PubSub specifics
