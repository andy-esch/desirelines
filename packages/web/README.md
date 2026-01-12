# Desirelines Web Frontend

React + TypeScript frontend for multi-sport activity visualization (cycling, running, yoga).

## Quick Start

```bash
npm install
cp .env.development.local.example .env.development.local
# Edit .env.development.local with Firebase credentials
npm run dev  # http://localhost:3000
```

## Environment Files

**Pattern**: `.env.{mode}` = template (committed) + `.env.{mode}.local` = your credentials (gitignored)

| Mode | Template (committed) | Your credentials (gitignored) | When used |
|------|---------------------|-------------------------------|-----------|
| `development` | `.env.development` | `.env.development.local` ✅ | `npm run dev` |
| `staging` | `.env.staging` | `.env.staging.local` ✅ | `deploy-web.sh dev` |
| `production` | `.env.production` | `.env.production.local` ✅ | `deploy-web.sh prod` |
| `test` | `.env.test` | None (uses mocks) | `npm test` |

**Setup**:
```bash
# Local dev
cp .env.development.local.example .env.development.local
# Edit with Firebase credentials from Firebase Console

# Staging deployment
cp .env.staging.local.example .env.staging.local
# Edit with staging credentials

# Production deployment  
cp .env.production.local.example .env.production.local
# Edit with production credentials
```

Get Firebase credentials: [Firebase Console](https://console.firebase.google.com/) → Project → Settings → Your apps

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server (localhost:3000) |
| `npm run build` | Production build |
| `npm test` | Run tests (watch mode) |
| `npm run test:ci` | Run tests once (CI) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | Lint code |
| `npm run format` | Format code |

## Deployment

```bash
# Dev/staging
just deploy-web dev

# Production
just deploy-web prod
```

Deploy script checks for required `.env.*.local` files and fails with helpful error if missing.

## Tech Stack

React 18 • TypeScript • Vite • Firebase Auth • Firestore • Recharts • Bootstrap 5 • Vitest

## Architecture

```
User → Components → API Layer → API Gateway (Go) → Cloud Storage (JSON)
                  ↓
            Firestore (User Config)
```

**Modes**:
- **Demo mode**: Client-side generated data, no API calls (anonymous users)
- **Authenticated mode**: Real data via API Gateway (signed-in users)

**User Data**:
- User configuration (goals, annotations, preferences) stored in Firestore
- Document path: `users/{userId}/config/v1`
- Firestore Security Rules enforce per-user isolation
- See `docs/architecture/authentication.md` for complete authentication architecture

## Structure

```
src/
├── api/              # API client (see [API README](src/api/README.md))
├── components/       # React components
├── constants/        # App constants and config
├── hooks/            # Custom hooks
├── lib/              # Config, auth utilities
├── pages/            # Route components
├── services/         # Business logic
├── types/            # TypeScript types
│   └── generated/    # Protobuf types (sports_metrics, user_config)
└── utils/            # Helpers (units, dates, demo data generator)
```

**Protobuf Types:** API response types are generated from `schemas/proto/`. Run `just proto-gen-web` to regenerate.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `auth/invalid-api-key` | Check `.env.*.local` exists with correct Firebase credentials |
| CORS errors | Use stable Cloud Run URL (format: `https://[function]-[number].[region].run.app`) |
| Env vars not updating | Restart dev server or delete `dist/` and rebuild |
| Missing `.env.*.local` | Deploy script will fail - copy from `.example` file |

## Docs

- **Environment setup**: See table above + `.env.*.local.example` files
- **Deployment**: `just deploy-web --help`
- **Architecture**: `docs/architecture/`
