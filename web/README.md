# Desire Lines Web Interface

React-based web application for visualizing Strava fitness data and tracking progress against personal goals. The primary user-facing interface for the desirelines platform.

## Features

- **Goal Visualization**: Track yearly distance goals with "desire line" progress charts
- **Distance Charts**: Cumulative distance tracking with goal comparison
- **Pacing Analytics**: Monitor daily pace and required effort to meet goals
- **Year Selector**: Browse historical years and compare performance over time
- **Responsive Design**: Clean, modern interface optimized for desktop and mobile

## Architecture

**Tech Stack:**
- React 18 with TypeScript
- Recharts for data visualization
- Axios for API communication
- Create React App build tooling

**Project Structure:**
```
web/
├── src/
│   ├── components/        # React components
│   │   ├── DistanceChart.tsx
│   │   ├── PacingChart.tsx
│   │   └── ...
│   ├── api/              # API client functions
│   │   └── activities.ts
│   ├── types/            # TypeScript type definitions
│   │   └── activity.ts
│   ├── constants/        # App constants
│   │   └── index.ts
│   └── App.tsx           # Main application component
└── public/               # Static assets
```

## Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Local Development

```bash
cd web

# Install dependencies
npm install

# Start development server
npm start
```

The app will open at [http://localhost:3000](http://localhost:3000).

**API Configuration:**
The web app connects to the API Gateway backend. Set the API URL via environment variable:

```bash
# .env.local
REACT_APP_API_BASE_URL=http://localhost:8084  # Local API Gateway
# or
REACT_APP_API_BASE_URL=https://your-api-gateway-url.run.app  # Cloud API Gateway
```

### Full Stack Development

To run the complete stack locally (backend + frontend):

```bash
# From project root - start backend services
docker compose up

# In a separate terminal - start web app
cd web && npm start
```

See [docs/guides/frontend-local-dev.md](../docs/guides/frontend-local-dev.md) for comprehensive setup instructions.

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm test -- --coverage
```

### Building for Production

```bash
# Create optimized production build
npm run build

# The build output will be in the build/ directory
# Deploy this directory to your static hosting provider
```

## Available Scripts

- `npm start` - Start development server (port 3000)
- `npm test` - Run test suite in watch mode
- `npm run build` - Build production-optimized bundle
- `npm run eject` - Eject from Create React App (irreversible)

## API Integration

The web app consumes data from the API Gateway:

**Endpoints:**
- `GET /activities/{year}/distances` - Distance chart data
- `GET /activities/{year}/pacings` - Pacing chart data
- `GET /activities/{year}/summary` - Activity summary statistics

**Data Flow:**
```
API Gateway (Go) → Cloud Storage (JSON) → Web App (TypeScript)
```

## Deployment

### Docker Deployment

The web app can be deployed via Docker:

```bash
# Build Docker image
docker build -f Dockerfile.react -t desirelines-web .

# Run container
docker run -p 3000:3000 desirelines-web
```

### Static Hosting

Build and deploy to any static hosting provider (Netlify, Vercel, Firebase Hosting, etc.):

```bash
npm run build
# Deploy the build/ directory
```

## Contributing

See the main project [README](../README.md) for contribution guidelines.
