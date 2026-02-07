# Demo Data System

How the app generates realistic data for unauthenticated visitors.

## Architecture Overview

```
useAuth() → user === null → Demo Mode
                           → Real API Data (authenticated)
```

When `useAuth()` returns no user, every data hook switches to locally-generated
demo data. No API calls are made for metrics, activities, or daily summaries.
Sport configuration (`sport_types.json`) is still fetched from the public API so
unknown sports get correct `has_distance` / `has_elevation` flags.

### Page routing

`UnifiedSportPage` checks auth and renders either `<SportPage>` (real data) or
`<DemoSportPage>` (generated data). The Dashboard is a single component that
branches internally: its child hooks (`useDailySportData`,
`useMultiSportChartData`, etc.) detect auth status and return demo data when
there is no user.

## Data Generation Pipeline

### 1. Fill levels

Each sport gets a **fill level** that controls data density:

| Level     | Behavior                                             |
|-----------|------------------------------------------------------|
| `full`    | Activities from Jan 1 at the configured rate         |
| `partial` | Activities start 60% into the year, rate halved      |
| `empty`   | No data — shows the empty-state UI                   |

Fill levels are **coordinated per session** so all components see the same
assignment. At most one sport is allowed to be `empty` (prevents a blank
dashboard). Stored in `sessionStorage`; refreshing the page rolls new levels.

### 2. Activity scheduling (Poisson + rest weeks)

Rather than flipping a coin per day, the generator divides the year into
7-day blocks and samples `Poisson(lambda)` for each week, where lambda is
`activitiesPerWeek` from the sport config. Days within each week are chosen
uniformly (Fisher-Yates shuffle). This produces realistic clustering —
some weeks have many activities, others few.

Sports can define a **rest pattern** (`restPattern` in `demoConfig.ts`) that
cycles between active and rest weeks. During rest weeks no activities are
generated, creating natural training periodization:

| Sport    | Pattern           | Meaning                       |
|----------|-------------------|-------------------------------|
| Cycling  | 4 on / 1 off      | Rest every 5th week           |
| Running  | 3 on / 1 off      | Rest every 4th week           |
| Yoga     | always on         | No rest weeks                 |
| Hiking   | 1 on / 5 off      | Sporadic — hike then long gap |
| Workout  | always on         | No rest weeks                 |

### 3. Value sampling (log-normal)

Distance and duration are sampled from a **log-normal distribution**
calibrated so `E[X] = mean`:

```
mu = ln(mean) - sigma^2 / 2
sample = exp(mu + sigma * Z)    where Z ~ N(0,1) via Box-Muller
```

Sigma controls spread:

- `0`   — returns mean exactly
- `0.3` — tight cluster
- `0.5` — moderate spread
- `0.8+` — wide tails

Elevation uses simple uniform variance (`+/- 50%`) since it matters less
visually.

All distribution functions live in `utils/distributions.ts` (pure, no deps).

### 4. Activity names

`utils/activityNameGenerator.ts` picks a name based on sport and hour-of-day
(morning / lunch / afternoon / evening). Weighted distribution:

- 60% — time prefix + sport suffix ("Morning Ride")
- 35% — sport-specific creative name ("Hill Repeats", "Vinyasa Flow")
- 5%  — 80s pop-culture easter egg ("Running Up That Hill (Literally)")

## Sport Configuration

Hardcoded in `constants/demoConfig.ts`. Parameters are derived from realistic
weekly training volumes:

| Sport    | Fill    | Weekly Volume | Sessions/wk | Rest Pattern  | Per-Session Avg       | Dist σ | Dur σ |
|----------|---------|---------------|-------------|---------------|-----------------------|--------|-------|
| Cycling  | full    | 80 mi/wk      | 4           | 4 on / 1 off  | 20 mi (~32 km), 1.3 h | 0.4    | 0.3   |
| Running  | partial | 12 mi/wk      | 3           | 3 on / 1 off  | 4 mi (~6.4 km), 40 min| 0.5    | 0.3   |
| Yoga     | empty   | 2 hr/wk       | 2           | always on     | — , 1 h               | —      | 0.2   |
| Hiking   | full    | 8 mi/wk       | 1           | 1 on / 5 off  | 8 mi (~13 km), 3 h    | 0.5    | 0.4   |
| Workout  | full    | 3 hr/wk       | 3           | always on     | — , 1 h               | —      | 0.3   |

Unknown sports fall back to sensible defaults based on `has_distance` /
`has_elevation` from the API config.

## Data Flow by Component

```
Dashboard
 ├─ MultiSportComparisonChart
 │   └─ useMultiSportChartData → useDailySportData → generateDemoDailyData()
 ├─ WeeklySummaryCard
 │   └─ useWeeklySummary → useDailySportData → generateDemoDailyData()
 ├─ GoalProgressCard
 │   └─ useDashboardGoalData → generateDemoMetrics() + generateDemoGoals()
 └─ ActivityCalendarHeatmap
     └─ useDailySportData → generateDemoDailyData()

DemoSportPage
 ├─ useDemoData → generateDemoMetrics()
 ├─ useDemoSidebarSportData → getDemoActivityCounts()
 └─ SportPageContent (same component as authenticated page)
```

### Key generator functions (`utils/demoDataGenerator.ts`)

| Function                     | Returns                           | Used by                    |
|------------------------------|-----------------------------------|----------------------------|
| `generateDemoMetrics`        | `MetricsEntry[]` (cumulative)     | Sport page chart, goals    |
| `generateDemoDailyData`      | `Record<date, DemoDailyActivity>` | Sparklines, heatmap, weekly|
| `generateDemoActivities`     | `ActivitySummary[]`               | Activity list              |
| `generateDemoGoals`          | `{ conservative, target, stretch }` | Goal controls            |
| `getDemoActivityCounts`      | `Record<sport, count>`            | Sidebar badge counts       |
| `getSessionFillLevels`       | `Record<sport, FillLevel>`        | All generators             |

## Caching

Two sessionStorage keys keep things consistent within a browser session:

- **`demo-fill-levels`** — coordinated fill level assignments
- **`demo-activity-counts`** — cached sidebar counts (avoids regenerating
  full metric arrays just for a number)

Both invalidate when the visible sports list changes.

## Calibration

Demo data has been visually calibrated so the dashboard heatmap and sparklines
look natural out of the box. There are two places to adjust values:

### Per-sport defaults (`constants/demoConfig.ts`)

Each sport's entry controls its base generation parameters:

```typescript
{
  activitiesPerWeek: 4,          // Poisson lambda — avg sessions per active week
  avgDistanceMeters: 32187,      // per-session mean (log-normal center)
  avgDurationSeconds: 4800,      // per-session mean
  distanceSigma: 0.4,            // log-normal spread (0 = exact, 0.6 = wide)
  durationSigma: 0.3,
  weeklyVolume: 80,              // display-unit reference (miles or hours)
  restPattern: { onWeeks: 4, offWeeks: 1 },  // training periodization
}
```

To make a sport busier, increase `activitiesPerWeek`. To make distances more
variable, increase `distanceSigma`. To add rest weeks, set `restPattern`.
Omit `restPattern` for always-on sports.

### Dashboard overrides (`pages/Dashboard.tsx`)

The dashboard passes a `DASHBOARD_DEMO_TUNING` constant to its child
components. This applies a **multiplier** to each sport's
`activitiesPerWeek` so the heatmap doesn't saturate when all sports are
summed together:

```typescript
const DASHBOARD_DEMO_TUNING: TuningParams = {
  activitiesPerWeekMultiplier: 0.7,  // 70% of each sport's configured rate
  distanceSigma: 0.6,                // "low" consistency — wider spread
  durationSigma: 0.5,
};
```

Sport-specific pages do **not** use this multiplier — they show data at
the full configured rate from `demoConfig.ts`.

### TuningParams interface

The `TuningParams` type in `utils/demoDataGenerator.ts` supports runtime
overrides that take precedence over config values. It's used internally by
the dashboard and is available for any future calibration needs:

| Field                          | Effect                                    |
|--------------------------------|-------------------------------------------|
| `activitiesPerWeek`            | Absolute override for Poisson lambda       |
| `activitiesPerWeekMultiplier`  | Scale factor on config's activitiesPerWeek |
| `distanceSigma`                | Override log-normal spread for distance    |
| `durationSigma`                | Override log-normal spread for duration    |
| `avgDistanceMeters`            | Override per-session mean distance         |
| `avgDurationSeconds`           | Override per-session mean duration          |
