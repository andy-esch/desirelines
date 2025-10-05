# Frontend Local Development Guide

Quick start guide for developing the React web UI with local fixture data.

## Quick Start

```bash
# Start the API Gateway with local fixtures
make start-frontend

# In a separate terminal, start the React web UI
make site-start
```

That's it! The web UI will be available at http://localhost:3000 and will connect to the local API Gateway serving fixture data.

## What Gets Started

The frontend development stack consists of:

1. **API Gateway** (port 8084) - Started with `make start-frontend`, serves local fixture data from `data/fixtures/`
2. **Web UI** (port 3000) - Started with `make site-start`, React development server with hot reload (runs via npm, not Docker)

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
# API Gateway logs
make logs-api

# Web UI logs (visible in the terminal where you ran `make site-start`)
# Ctrl+C to stop the React dev server
```

## Memory Optimization

The frontend stack is optimized for low-memory systems:

**API Gateway (Docker):**
- Memory limit: 128MB
- Reserved: 32MB

**Web UI (npm):**
- Runs directly via npm (not containerized)
- Uses default Node.js memory settings
- Typically ~200-400MB depending on usage

**Total frontend stack: ~300-500MB memory**

## Troubleshooting

### Port Already in Use
If ports 3000 or 8084 are busy:
```bash
# Stop API Gateway
make stop-frontend

# Stop Web UI (Ctrl+C in the terminal running it, or:)
lsof -i :3000  # Find the process
kill <PID>     # Kill the process

# Check for other processes using the ports
lsof -i :3000
lsof -i :8084
```

### API Gateway Build Issues
```bash
# Clean rebuild of API Gateway
make stop-frontend
docker compose --profile frontend build --no-cache api-gateway
make start-frontend
```

### Web UI Issues
```bash
# Reinstall dependencies
cd web
rm -rf node_modules package-lock.json
npm install

# Start again
make site-start
```

### Fixture Data Not Loading
Check the health endpoint and logs to verify configuration:
```bash
# Check API Gateway is running
curl http://localhost:8084/health
# Should return: {"status":"healthy"}

# Check logs for data source confirmation
make logs-api
# Should show: "Using local fixtures from: /app/data/fixtures"
```

## Next Steps

Once the local stack is running, you can:
1. **Scope the UI** - Define requirements and user flows
2. **Build components** - Create React components for data visualization
3. **Test with data** - Develop against real production data locally

See `docs/planning/project-master-plan.md` for the complete web UI rebuild plan.
