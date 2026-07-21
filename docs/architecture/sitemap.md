# Application Sitemap

## Routes Overview

```
/ (root)
├─ /                    ← Dashboard (landing page)
├─ /dashboard           ← Dashboard (alias)
│
├─ /cycling             ← Cycling detail (current year)
├─ /cycling/:year       ← Cycling detail (specific year)
├─ /running             ← Running detail (current year)
├─ /running/:year       ← Running detail (specific year)
├─ /yoga                ← Yoga detail (current year)
├─ /yoga/:year          ← Yoga detail (specific year)
│
├─ /activities          ← Activities list (table)          ┐
├─ /charts              ← Activity volume charts           ├ Activities group
├─ /routes              ← Route map (Mapbox slippy map)     ┘  (shared filters)
│
├─ /origins             ← Project philosophy (static)
├─ /settings            ← User preferences
│
├─ /demo                ← Dashboard, forced demo data
├─ /demo/:sport         ← Sport detail, forced demo data
├─ /demo/:sport/:year   ← Sport detail (year), forced demo data
│
└─ /auth/complete       ← OAuth callback (sign-in completion)
   /auth/error          ← OAuth callback (sign-in error)
```

## Route Details

### Dashboard

- **Path**: `/` or `/dashboard`
- **Component**: `Dashboard`
- **Purpose**: Landing page showing all sports overview
- **Auth**: Public (demo data when signed out)
- **Features**:
  - Multi-sport comparison chart
  - Sport cards with mini-charts
  - Goal progress summaries
  - Navigation to sport detail pages

### Sport Detail Pages

- **Path**: `/:sport` or `/:sport/:year`
- **Component**: `SportPage`
- **Valid sports**: `cycling`, `running`, `yoga`
- **Purpose**: Detailed charts and analysis for a specific sport/year
- **Auth**: Public (demo data when signed out)
- **Features**:
  - Cumulative metrics chart
  - Pacing analysis
  - Goal controls
  - Year navigation

### Activities Group

Three coordinated views of the full activity set, nested under the **Activities**
navigation dropdown. They share the `?sports=` URL search param (multi-select,
comma-joined categories; absent = all sports) so a sport selection persists as you
move between them. List and Charts additionally share the `?range=` time presets;
the Routes map keeps its own explicit date window (`?from=`/`?to=`), so time
deliberately does not cross the map boundary.

- **Auth**: Public (demo data when signed out)

| View | Path | Component | Purpose |
|------|------|-----------|---------|
| List | `/activities` | `ActivitiesPage` | Paginated activity table with range + sport filters |
| Charts | `/charts` | `ChartsPage` | Monthly activity-volume bar charts (distance / time / sessions), stacked by sport |
| Routes | `/routes` | `RoutesPage` | Mapbox slippy map of activity routes |

Notes:

- **Charts** aggregates the activity list **client-side** into month × sport ×
  geography buckets (see `utils/activityBuckets.ts`); it includes indoor/virtual
  workouts that never appear on the route map. Metric (distance/time/sessions),
  activity type (all/outdoor/indoor), sport, and time range are all selectable.
- **Routes** needs a public Mapbox access token to render the map; without it the
  view degrades gracefully (see `packages/web/README.md`).

### Origins

- **Path**: `/origins`
- **Component**: `OriginsPage`
- **Purpose**: Static page explaining the project philosophy and the meaning of
  "desire lines"
- **Auth**: Public

### Settings

- **Path**: `/settings`
- **Component**: `SettingsPage`
- **Purpose**: User preferences — display units (distance/elevation), timezone,
  visible sports, and goal management
- **Auth**: Public (preferences apply to the demo experience when signed out)

### Demo Routes

- **Paths**: `/demo`, `/demo/:sport`, `/demo/:sport/:year`
- **Components**: `Dashboard` / `SportPage` (same components as the primary routes)
- **Purpose**: Shareable entry points that render the standard pages against
  generated demo data regardless of auth state

### Auth Callbacks

- **Paths**: `/auth/complete`, `/auth/error`
- **Purpose**: OAuth sign-in completion and error landing pages

## Navigation Patterns

1. **Dashboard → Sport Detail**: Click a sport card or the **Goals** dropdown
2. **Any view → Dashboard**: Click "Dashboard" or the logo in the nav
3. **Activities group**: The **Activities** dropdown switches between List, Charts,
   and Routes while preserving the shared `?sports=` filter (and `?range=` between
   List and Charts); each route strips the params it doesn't model
4. **Year navigation**: Within sport detail pages

## URL Structure Philosophy

- **Human-readable**: `/cycling/2025`, not `/s/c/25`
- **RESTful**: Resource-oriented paths
- **Consistent**: All sports follow the same pattern
- **Shared filters**: Activities-group views coordinate via `?sports=` (plus
  `?range=` on List/Charts)
- **Backward compatible**: Existing links continue to work
- **`/demo/` prefix**: Opt-in shareable demo entry points; the primary routes still
  choose their data source from auth state, not the URL

## Authentication Behavior

| User State | Access | Data Source |
|------------|--------|-------------|
| Not signed in | Full access (all public routes) | Generated demo data |
| Signed in (authorized) | Full access | API (PostgreSQL) |
| Signed in (unauthorized) | Auto sign-out | Generated demo data |

## Invalid Route Handling

- Invalid sport (e.g., `/basketball/2025`) → Redirect to `/`
- Invalid year format → Redirect to current year
- Unknown paths → Redirect to `/`
</content>

</invoke>
