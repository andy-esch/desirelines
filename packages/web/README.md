# Desirelines Web Frontend

React + TypeScript frontend for multi-sport activity visualization (cycling, running, yoga).

## Quick Start

```bash
npm install
cp .env.development.local.example .env.development.local
# Edit .env.development.local with Firebase credentials
npm run dev  # http://localhost:5173
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
| `npm run dev` | Dev server (localhost:5173) |
| `npm run build` | Production build |
| `npm test` | Run tests (watch mode) |
| `npm run test:ci` | Run tests once (CI) |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | Lint code |
| `npm run format` | Format code |

## Deployment

```bash
# Dev/staging
./scripts/infrastructure/deploy-web.sh dev

# Production
./scripts/infrastructure/deploy-web.sh prod
```

Deploy script checks for required `.env.*.local` files and fails with helpful error if missing.

## Tech Stack

React 18 • TypeScript • Vite • Firebase Auth • Firestore • Recharts • Bootstrap 5 • Vitest

## Architecture

```
User → Components → API Layer → API Gateway (Go) → Cloud Storage (JSON)
```

**Modes**:
- **Fixture mode**: Local data, no API calls (anonymous users, tests)
- **Smart mode**: Fixtures for anonymous, API for authenticated (production)

## Structure

```
src/
├── api/              # API client
├── components/       # React components  
├── data/fixtures/    # Demo data
├── hooks/            # Custom hooks
├── lib/              # Config, auth utilities
├── pages/            # Route components
├── services/         # Business logic
├── types/            # TypeScript types
└── utils/            # Helpers (units, dates, goals)
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `auth/invalid-api-key` | Check `.env.*.local` exists with correct Firebase credentials |
| CORS errors | Use stable Cloud Run URL (format: `https://[function]-[number].[region].run.app`) |
| Env vars not updating | Restart dev server or delete `dist/` and rebuild |
| Missing `.env.*.local` | Deploy script will fail - copy from `.example` file |

## Docs

- **Environment setup**: See table above + `.env.*.local.example` files
- **Deployment**: `./scripts/infrastructure/deploy-web.sh --help`
- **Architecture**: `docs/architecture/`
