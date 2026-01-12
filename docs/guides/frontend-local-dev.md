# Frontend Local Development Guide

Guide for developing the React web UI locally.

## Quick Start

```bash
cd packages/web
npm install
npm run dev
```

The web UI will be available at http://localhost:3000.

## Development Modes

### Demo Mode (Unauthenticated)

When not signed in, the app displays **generated demo data**:
- Realistic activity patterns created client-side
- No backend services required
- Perfect for UI development and testing

Just run `npm run dev` and start developing.

### Authenticated Mode (Local Emulators)

For fully offline authenticated development using Firebase Emulators:

1. **Start backend services**:
   ```bash
   just start-frontend  # Starts Firebase Emulators + API Gateway + PostgreSQL
   ```

2. **Enable emulators in frontend**:
   ```bash
   # In packages/web/.env.development.local:
   VITE_USE_FIREBASE_EMULATORS=true
   VITE_API_GATEWAY_URL=http://localhost:8084
   ```

3. **Start frontend dev server**:
   ```bash
   cd packages/web && npm run dev
   ```

Console should show:
```
🔐 Auth emulator connected: 127.0.0.1:9099
🔥 Firestore emulator connected: 127.0.0.1:8089
```

The Firebase Emulator UI is available at http://localhost:4000 for managing test users.

**Note:** Emulator data is in-memory only and resets when stopped.

### Authenticated Mode (Cloud Firebase)

To use real Firebase Auth with the local API Gateway:

1. **Set up Application Default Credentials**:
   ```bash
   gcloud auth application-default login
   ```

2. **Configure `.env`** (in repo root):
   ```bash
   cp .env.local.example .env.local
   # Edit .env.local with:
   ALLOWED_EMAILS=your-email@example.com  # Must match your login email
   ```

3. **Update docker-compose.local.yml** to use cloud Firebase instead of emulators.

4. **Start services**:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.local.yml --profile frontend up
   ```

### Use Deployed Dev API

For simplest setup, point to the deployed dev API:
```bash
# In packages/web/.env.development.local:
VITE_API_GATEWAY_URL=https://api-gateway-xxxxx.run.app
```
No local backend setup needed.

## Environment Configuration

Create `packages/web/.env.development.local` (gitignored) with your Firebase credentials:

```bash
# Firebase config (required for auth)
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id

# Optional: Use Firebase emulators
VITE_USE_FIREBASE_EMULATORS=true

# Optional: Override API Gateway URL
VITE_API_GATEWAY_URL=http://localhost:8084
```

## Service URLs

| Service | URL | Notes |
|---------|-----|-------|
| Web UI | http://localhost:3000 | Vite dev server |
| API Gateway | http://localhost:8084 | When running locally |
| Firebase Emulator UI | http://localhost:4000 | Manage test users |
| Auth Emulator | localhost:9099 | When emulators enabled |
| Firestore Emulator | localhost:8089 | When emulators enabled |

## Common Commands

```bash
# Start dev server
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Run tests
npm test

# Run tests with UI
npm run test:ui
```

## Development Workflow

### UI Changes
- Edit files in `packages/web/src/`
- Hot reload picks up changes automatically
- No restart needed

### Testing Auth Flows
- Use demo mode for UI development
- Use Firebase Emulators for authenticated local testing
- Create test users in Emulator UI (http://localhost:4000)

## Troubleshooting

### Port Already in Use
```bash
lsof -i :3000
kill <PID>
```

### Dependencies Issues
```bash
cd packages/web
rm -rf node_modules package-lock.json
npm install
```

### Firestore Permission Errors
- Check if emulators are running: `docker ps | grep firebase`
- Verify `VITE_USE_FIREBASE_EMULATORS=true` is set
- Restart dev server after changing env vars

### Auth Emulator Issues
- Verify `FIREBASE_AUTH_EMULATOR_HOST` is set in API Gateway logs
- Check Emulator UI at http://localhost:4000 for test users
- Ensure test user email is in `ALLOWED_EMAILS` in `.env.local`
