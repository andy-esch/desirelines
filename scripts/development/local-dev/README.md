# Local Development Scripts

This directory contains scripts specifically for local development environment setup and bootstrapping.

## Scripts Overview

### `setup-local-environment.sh` 🚀
**Master setup script** that orchestrates the complete local development environment:
- Checks prerequisites (uv, docker, go)
- Installs Python and Go dependencies
- Creates .env file from template
- Shows development mode options and next steps

**Usage:**
```bash
./scripts/development/local-dev/setup-local-environment.sh
```

### `bootstrap_pubsub.sh` 📫
**PubSub emulator setup** for Docker Compose local development:
- Waits for PubSub emulator to be ready
- Creates `desirelines_activity_events` topic
- Creates push subscriptions that route through the CloudEvent adapter
- Used automatically by `docker-compose.yml`

**Environment Variables:**
- `PUBSUB_EMULATOR_HOST` (default: localhost:8085)
- `PROJECT_ID` (default: local-dev)
- `TOPIC_NAME` (default: desirelines_activity_events)

### `cloudevent_adapter.py` 🔄
**CloudEvent adapter** bridges PubSub emulator and Cloud Run services:
- Receives raw PubSub push messages from the emulator
- Wraps them with Eventarc-style CloudEvent headers (`ce-type`, `ce-id`, `ce-source`, `ce-time`)
- Forwards to target services (bq-inserter, postgres-writer)
- Ensures local development uses the exact same code path as production

**Why this exists:** In production, Eventarc automatically adds CloudEvent headers when delivering PubSub messages to Cloud Run. The PubSub emulator doesn't do this, so this adapter fills the gap.

**Endpoints:**
- `POST /bq-inserter` → forwards to `http://bq-inserter:8080`
- `POST /postgres-writer` → forwards to `http://postgres-writer:8080`
- `GET /health` → health check

### `bootstrap_bigquery.sh` 📊
**BigQuery setup** for hybrid local development:
- Creates local development dataset
- Creates activities table with basic schema
- Used when developing with real GCP resources

**Environment Variables:**
- `PROJECT_ID` (default: local-dev)
- `DATASET_NAME` (default: strava_dev_local)

## Development Modes

### 1. Pure Local Mode
```bash
make start
```
- **Infrastructure**: PubSub emulator + local storage simulation
- **Uses**: `bootstrap_pubsub.sh`
- **Best for**: Offline development, testing pipeline logic

### 2. Hybrid Local Mode
```bash
make start-local
```
- **Infrastructure**: Terraform-managed BigQuery & Cloud Storage + PubSub emulator
- **Uses**: `bootstrap_pubsub.sh` + real GCP resources
- **Best for**: Realistic testing with data persistence

### 3. Frontend Development
```bash
make start --profile frontend
make start-local --profile frontend
```
- **Additional**: React web app + API gateway
- **Best for**: Full-stack development and UI work

## Best Practices

### Organization Principles
- ✅ **Separation of Concerns**: Local dev scripts isolated from deployment/production scripts
- ✅ **Self-Documenting**: Each script has clear purpose and usage
- ✅ **Orchestration**: Master setup script guides users through options
- ✅ **Environment Flexibility**: Support both pure local and hybrid modes

### Directory Structure
```
scripts/
├── development/local-dev/            # Local development only
│   ├── README.md                     # This file
│   ├── setup-local-environment.sh    # Master setup script
│   ├── bootstrap_pubsub.sh           # PubSub emulator setup
│   ├── bootstrap_bigquery.sh         # BigQuery setup
│   ├── cloudevent_adapter.py         # CloudEvent wrapper service
│   └── Dockerfile.cloudevent_adapter # Docker build for adapter
├── infrastructure/                   # Environment setup and deployment
│   ├── deploy-secrets.sh             # Deploy secrets to Secret Manager
│   └── bootstrap-environment.sh      # Complete env bootstrap
└── operations/                       # Build and deployment tasks
    ├── build-and-publish.sh          # Build and push Docker images
    └── webhook-management.sh         # Webhook management
```

### Getting Started
1. **First Time Setup**: `./scripts/development/local-dev/setup-local-environment.sh`
2. **Daily Development**: `make start` or `make start-local`
3. **Frontend Work**: Add `--profile frontend` to any make command

This organization follows the principle of **"local development should be simple and self-contained"** while keeping production deployment scripts separate and focused.

## Related Documentation

- [Frontend Local Development](../../../docs/guides/frontend-local-dev.md) - Full stack local development guide
- [Local Testing Setup](../../../docs/guides/local-testing.md) - Docker development environment
- [Bootstrap Guide](../../../docs/guides/bootstrap.md) - Complete environment setup (dev/prod)
