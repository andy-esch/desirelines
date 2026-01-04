# Application Sitemap

## Routes Overview

```
/ (root)
├─ /                    ← Dashboard (landing page)
├─ /dashboard           ← Dashboard (alias)
│
├─ /cycling             ← Cycling detail (current year)
├─ /cycling/:year       ← Cycling detail (specific year)
│
├─ /running             ← Running detail (current year)
├─ /running/:year       ← Running detail (specific year)
│
├─ /yoga                ← Yoga detail (current year)
├─ /yoga/:year          ← Yoga detail (specific year)
│
└─ /settings            ← User preferences (future)
```

## Route Details

### Dashboard
- **Path**: `/` or `/dashboard`
- **Component**: `Dashboard`
- **Purpose**: Landing page showing all sports overview
- **Auth**: Public
- **Data source**:
  - Authenticated: Real data from API
  - Unauthenticated: Fixture/demo data
- **Features**:
  - Multi-sport comparison chart
  - Sport cards with mini-charts
  - Goal progress summaries
  - Navigation to sport detail pages

### Sport Detail Pages
- **Path**: `/:sport` or `/:sport/:year`
- **Component**: `SportPage`
- **Valid sports**: `cycling`, `running`, `yoga`
- **Purpose**: Detailed charts and analysis for specific sport/year
- **Auth**: Public
- **Data source**:
  - Authenticated: Real data from API
  - Unauthenticated: Fixture/demo data
- **Features**:
  - Cumulative metrics chart
  - Pacing analysis
  - Goal controls
  - Year navigation

### Settings (Future)
- **Path**: `/settings`
- **Component**: `Settings`
- **Purpose**: User preferences, goal management
- **Auth**: Required

## Navigation Patterns

1. **Dashboard → Sport Detail**: Click sport card or nav link
2. **Sport Detail → Dashboard**: Click "Dashboard" or logo in nav
3. **Sport Detail → Sport Detail**: Click sport in nav bar
4. **Year navigation**: Within sport detail pages

## URL Structure Philosophy

- **Human-readable**: `/cycling/2025` not `/s/c/25`
- **RESTful**: Resource-oriented paths
- **Consistent**: All sports follow same pattern
- **Backward compatible**: Existing links continue to work
- **No `/demo/` prefix**: Data source determined by auth state, not route

## Authentication Behavior

| User State | Dashboard | Sport Pages | Data Source |
|------------|-----------|-------------|-------------|
| Not signed in | Full access | Full access | Fixtures |
| Signed in (authorized) | Full access | Full access | API (PostgreSQL) |
| Signed in (unauthorized) | Auto sign-out | Auto sign-out | Fixtures |

## Invalid Route Handling

- Invalid sport (e.g., `/basketball/2025`) → Redirect to `/`
- Invalid year format → Redirect to current year
- Unknown paths → Redirect to `/`
