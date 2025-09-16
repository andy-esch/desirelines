# Complete Setup Guide

This guide covers everything you need to get Desire Lines running locally and in the cloud.

## Quick Start

```bash
# 1. One-command setup
./scripts/local-dev/setup-local-environment.sh

# 2. Start local services
make start

# 3. Test the pipeline
make test-full-flow
```

## Prerequisites

### Required Tools

- **uv** (Python package manager): `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Go 1.25+**: Download from https://golang.org/dl/
- **Docker**: Download from https://docker.com/get-started
- **Node.js 18+**: For frontend development (optional)

### For Cloud Deployment (Optional)

- **Google Cloud SDK**: `gcloud` CLI for cloud deployment
- **Terraform**: Infrastructure as code (optional, for advanced users)

### For Strava Integration (Optional)

- **Strava Developer Account**: Create at https://www.strava.com/settings/api

## Local Development Modes

### 1. Pure Local Mode (Recommended for First-Time)

**Best for**: Learning the system, offline development, testing pipeline logic

```bash
make start
```

**What it does:**

- Runs PubSub emulator (no internet required)
- Uses local storage simulation
- All services in Docker containers
- Perfect for understanding how the system works

### 2. Hybrid Local Mode

**Best for**: Realistic development, persistent data, testing with real cloud services

```bash
make start-local
```

**What it does:**

- Uses real BigQuery and Cloud Storage (via Terraform)
- PubSub emulator for messaging
- Requires GCP authentication but gives realistic testing

**Prerequisites:**

```bash
# Setup Terraform resources first
make setup-local
make tf-local-apply

# Authenticate with GCP
gcloud auth application-default login
```

### 3. Frontend Development Mode

**Best for**: UI development, full-stack testing

```bash
# Add to either mode above
make start --profile frontend           # Pure local + UI
make start-local --profile frontend     # Hybrid + UI
```

**Services available:**

- React web app: http://localhost:3000
- API Gateway: http://localhost:8084

## Strava Integration Setup

### Step 1: Create Strava Application

1. Go to https://www.strava.com/settings/api
2. Create a new application
3. Note your `Client ID` and `Client Secret`

### Step 2: Get Refresh Token

Follow the OAuth2 flow to get a refresh token (see [`strava-webhook-setup.md`](./strava-webhook-setup.md) for details).

### Step 3: Create Secrets File

```bash
# Copy the example
cp strava-auth-example.json strava-auth-dev.json

# Edit with your actual values
{
  "client_id": YOUR_CLIENT_ID,
  "client_secret": "YOUR_CLIENT_SECRET",
  "refresh_token": "YOUR_REFRESH_TOKEN",
  "webhook_verify_token": "generate_random_string_here",
  "webhook_subscription_id": 123456
}
```

### Step 4: Deploy Secrets (For Cloud Development)

```bash
make deploy-secrets dev SECRET_FILE=strava-auth-dev.json
make create-webhook dev
```

## Cloud Deployment

### Development Environment

```bash
cd terraform/environments/dev
terraform init
terraform apply

# Deploy functions
make package-functions
# Functions are deployed via Terraform
```

### Production Environment

```bash
cd terraform/environments/prod
terraform init
terraform apply
```

## Troubleshooting

### Common Issues

**Docker build fails on React app:**

- Issue: Out of memory during npm install
- Solution: Increase Docker memory limit to 4GB+

**PubSub connection errors:**

- Issue: Services can't connect to PubSub emulator
- Solution: Wait for emulator bootstrap, check `make logs`

**Strava webhooks not working:**

- Issue: Missing OAuth2 authorization (very common!)
- Solution: Complete OAuth2 flow first, see [`strava-webhook-setup.md`](./strava-webhook-setup.md)

**BigQuery permissions error in hybrid mode:**

- Issue: Service account lacks permissions
- Solution: Run `make setup-local` to configure service accounts

### Getting Help

1. **Check logs**: `make logs` for all services, `make logs-dispatcher` for specific service
2. **Verify setup**: Re-run `./scripts/local-dev/setup-local-environment.sh`
3. **Clean slate**: `make clean` then `make start`

## Development Workflow

### Daily Development

```bash
# Start your preferred mode
make start                    # or make start-local

# Make changes to code
# Services auto-reload in development mode

# Test your changes
make test-full-flow

# View logs
make logs

# Stop when done
make stop
```

### Testing Changes

```bash
# Run unit tests
make test

# Test full pipeline
make test-full-flow

# Test specific service
curl -X POST http://localhost:8081 \
  -H "Content-Type: application/json" \
  -d '{"object_type": "activity", "object_id": 123, "aspect_type": "create", "owner_id": 456}'
```

### Making Code Changes

**Python functions** (`functions/`, `packages/desirelines/`, `packages/stravabqsync/`):

- Changes automatically reload in Docker containers
- Run `make test` to verify

**Go dispatcher** (`packages/dispatcher/`):

- Changes require container rebuild: `docker-compose build activity-dispatcher-go`

**React frontend** (`web/`):

- Hot reload enabled when running with `--profile frontend`

## Next Steps

Once you have local development working:

1. **Explore the codebase**: Start with [`project-master-plan.md`](./project-master-plan.md)
2. **Set up cloud deployment**: Follow cloud deployment section above
3. **Configure Strava integration**: Complete webhook setup for real data
4. **Contribute**: The project welcomes contributions and feedback!

## Documentation Index

- **[Strava Webhook Setup](./strava-webhook-setup.md)** - OAuth2 and webhook configuration
- **[Frontend Development](./frontend-development.md)** - React app development guide
- **[Local Development Scripts](../scripts/local-dev/README.md)** - Script organization and usage
