# Desirelines Web Frontend

React + TypeScript frontend for multi-sport activity visualization (cycling, running, yoga).

## Quick Start

```bash
npm install
npm run dev  # http://localhost:3000 — starts in demo mode (no backend needed)
```

For authenticated local dev, run `just start-frontend` to start Firebase emulators + API Gateway, then click "Connect with Strava" in the UI. See `docs/guides/frontend-local-dev.md` for details.

## Environment Files

**Pattern**: `.env.{mode}` = defaults/placeholders (committed) + `.env.{mode}.local` = your credentials (gitignored)

| Mode          | Defaults (committed) | Your credentials (gitignored) | When used              |
| ------------- | -------------------- | ----------------------------- | ---------------------- |
| `development` | `.env.development`   | `.env.development.local`      | `npm run dev`          |
| `staging`     | `.env.staging`       | `.env.staging.local`          | `just deploy-web dev`  |
| `production`  | `.env.production`    | `.env.production.local`       | `just deploy-web prod` |
| `test`        | `.env.test`          | None (uses mocks)             | `npm test`             |

**Setup**: For local development, Firebase emulators are enabled by default — no `.local` file needed. For staging/production deploys, create `.local` files with your real Firebase credentials:

```bash
# Staging / production — add Firebase credentials
# See the committed .env.{mode} files for required variables
vi .env.staging.local
vi .env.production.local
```

Get Firebase credentials: [Firebase Console](https://console.firebase.google.com/) → Project → Settings → Your apps

## Mapbox token

The `/routes` slippy map uses Mapbox GL JS and needs a **public** access token
(`VITE_MAPBOX_TOKEN`). This token ships in the client bundle, so it must be a
public `pk.*` token — **never** a secret token — and should be **URL-restricted**
in the Mapbox account to the app's web origins (the deployed hosting domains plus
`http://localhost:3000` for local dev). Without it, `/routes` degrades to a
graceful "map unavailable" state.

Like the Firebase config, it's provisioned through Infisical (path `/frontend`)
and exported into the per-mode `.env.*.local` files automatically:

- **Local dev**: `just setup-secrets` writes it into `.env.development.local`.
- **Staging/prod deploy**: `just deploy-web dev|prod` exports it into
  `.env.staging.local` / `.env.production.local` before the build.

To provision it:

1. In the Mapbox account, create a public token, scope it to public styles/tiles,
   and add URL restrictions for the web origins above.
2. Add it to Infisical under `/frontend` as `VITE_MAPBOX_TOKEN` for each
   environment (`dev`, `prod`).
3. Re-run `just setup-secrets` (local) or the deploy script (staging/prod).

## Scripts

| Command             | Description                 |
| ------------------- | --------------------------- |
| `npm run dev`       | Dev server (localhost:3000) |
| `npm run build`     | Production build            |
| `npm test`          | Run tests (watch mode)      |
| `npm run test:run`  | Run tests once (CI)         |
| `npm run typecheck` | TypeScript check            |
| `npm run lint`      | Lint code                   |
| `npm run format`    | Format code                 |

## Deployment

```bash
# Dev/staging
just deploy-web dev

# Production
just deploy-web prod
```

Deploy script checks for required `.env.*.local` files and fails with helpful error if missing.

## Tech Stack

React • TypeScript • Vite • Tailwind CSS • React Router • React Query • Headless UI • Firebase Auth • Firestore • Axios • Recharts • Zod • Vitest

## Architecture

```
User → Components → API Layer → API Gateway (Go) → Cloud Storage (JSON)
                  ↓
            Firestore (User Config)
```

**Bundle Optimization**: Pages are lazy-loaded via `React.lazy()` with vendor chunks (React, Firebase, Recharts, React Query, Headless UI, Zod) split for independent caching. Main bundle ~283KB gzipped ~94KB, with heavy dependencies loaded on-demand. Hashed assets are cached immutably; `index.html` uses `no-cache` to ensure fresh chunk references after deploys.

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
├── api/              # API client, interceptors (see [API README](src/api/README.md))
├── components/       # React components
├── config/           # Metric and sport configuration
├── constants/        # App constants
├── contexts/         # React contexts (Auth, Services, UIState)
├── css/              # Tailwind CSS entry point
├── hooks/            # Custom hooks
├── lib/              # Config, Firebase init
├── pages/            # Route components (lazy-loaded)
├── services/         # Business logic (auth, database)
├── types/            # TypeScript types
│   └── generated/    # Protobuf types (sports_metrics, user_config)
└── utils/            # Helpers (units, dates, demo data, chunk load handler)
```

**Protobuf Types:** API response types are generated from `schemas/proto/`. Run `just proto-gen-web` to regenerate.

## Troubleshooting

| Issue                  | Solution                                                                          |
| ---------------------- | --------------------------------------------------------------------------------- |
| `auth/invalid-api-key` | Check `.env.*.local` exists with correct Firebase credentials                     |
| CORS errors            | Use `http://localhost:8084` for local dev or `/api` for deployed environments     |
| Env vars not updating  | Restart dev server or delete `build/` and rebuild                                 |
| Missing `.env.*.local` | Deploy script will fail — create from the committed `.env.{mode}` template        |

## Docs

- **Environment setup**: See table above + committed `.env.{mode}` files
- **Deployment**: `just deploy-web --help`
- **Architecture**: `docs/architecture/`
