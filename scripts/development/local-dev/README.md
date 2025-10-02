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
./scripts/local-dev/setup-local-environment.sh
```

### `bootstrap_pubsub.sh` 📫
**PubSub emulator setup** for Docker Compose local development:
- Waits for PubSub emulator to be ready
- Creates `strava-webhooks` topic
- Creates push subscriptions for aggregator and BQ inserter
- Used automatically by `docker-compose.yml`

**Environment Variables:**
- `PUBSUB_EMULATOR_HOST` (default: localhost:8085)
- `PROJECT_ID` (default: local-dev)
- `TOPIC_NAME` (default: strava-webhooks)

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
├── local-dev/                    # Local development only
│   ├── README.md                 # This file
│   ├── setup-local-environment.sh   # Master setup script
│   ├── bootstrap_pubsub.sh       # PubSub emulator setup
│   └── bootstrap_bigquery.sh     # BigQuery setup
├── deploy-secrets.sh             # Production deployment
├── webhook-management.sh         # Production webhook management
└── package-functions.sh          # Production packaging
```

### Getting Started
1. **First Time Setup**: `./scripts/local-dev/setup-local-environment.sh`
2. **Daily Development**: `make start` or `make start-local`
3. **Frontend Work**: Add `--profile frontend` to any make command

This organization follows the principle of **"local development should be simple and self-contained"** while keeping production deployment scripts separate and focused.
