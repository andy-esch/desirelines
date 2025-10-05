# Frontend Local Development Guide

Quick start guide for developing the React web UI with local fixture data.

## Quick Start

```bash
# Start the frontend development stack (API Gateway + Web UI)
make start-frontend

# View logs
make logs-frontend

# Stop services
make stop-frontend
```

That's it! The web UI will be available at http://localhost:3000 and will connect to a local API Gateway serving fixture data.

## What Gets Started

The `make start-frontend` command starts two services:

1. **API Gateway** (port 8084) - Serves local fixture data from `data/fixtures/`
2. **Web UI** (port 3000) - React development server with hot reload

## Service URLs

- 🌐 **Web UI**: http://localhost:3000
- 🔌 **API Gateway**: http://localhost:8084
- 📊 **Health Check**: http://localhost:8084/health

## Data Source Modes

### Local Fixtures (Default)
Uses data copied from the old production system (`progressor-341702`):
```bash
make start-frontend
```

The API Gateway reads from `data/fixtures/activities/` directory, no cloud access needed.

### Live Cloud Data
To develop against live cloud storage:
```bash
DATA_SOURCE=cloud-storage make start-frontend
```

Requires `gcloud` authentication and access to the configured GCS bucket.

## Available API Endpoints

All endpoints return JSON data:

- `GET /health` - Health check with data source info
- `GET /activities/{year}/summary` - Daily activity summaries
- `GET /activities/{year}/distances` - Distance aggregations
- `GET /activities/{year}/pacings` - Pacing analysis

Example:
```bash
curl http://localhost:8084/activities/2024/summary
```

## Fixture Data

Located in `data/fixtures/activities/`:
- **2023-2025** data covering multiple years
- **~6.2MB** total, 338 files
- **Aggregated summaries**: distances.json, pacings.json, summary_activities.json

See `data/fixtures/README.md` for detailed data structure.

## Development Workflow

### Making Changes

**Web UI changes:**
- Edit files in `web/src/`
- Hot reload will pick up changes automatically
- No restart needed

**API Gateway changes:**
- Edit Go code in `packages/apigateway/`
- Restart: `make stop-frontend && make start-frontend`

### Viewing Logs

```bash
# All frontend logs (API Gateway + Web UI)
make logs-frontend

# Just API Gateway
make logs-api

# Just Web UI
make logs-web
```

## Memory Optimization

The frontend stack is optimized for low-memory systems:

**API Gateway:**
- Memory limit: 256MB
- Reserved: 64MB

**Web UI:**
- Node.js heap: 512MB (`--max-old-space-size=512`)
- Container limit: 768MB
- Reserved: 256MB

**Total frontend stack: ~1GB memory**

If you experience memory issues, you can:
1. Increase Node.js heap: `NODE_OPTIONS=--max-old-space-size=1024 make start-frontend`
2. Run web UI directly (no Docker): `make site-start` (requires `npm install` in web/)

## Troubleshooting

### Port Already in Use
If ports 3000 or 8084 are busy:
```bash
# Stop any existing frontend services
make stop-frontend

# Check for other processes
lsof -i :3000
lsof -i :8084
```

### Docker Build Issues
```bash
# Clean rebuild
make stop-frontend
docker compose --profile frontend build --no-cache
make start-frontend
```

### Fixture Data Not Loading
Check the health endpoint to verify configuration:
```bash
curl http://localhost:8084/health
# Should show: "data_source": "local-fixtures"
```

## Next Steps

Once the local stack is running, you can:
1. **Scope the UI** - Define requirements and user flows
2. **Build components** - Create React components for data visualization
3. **Test with data** - Develop against real production data locally

See `docs/planning/project-master-plan.md` for the complete web UI rebuild plan.
