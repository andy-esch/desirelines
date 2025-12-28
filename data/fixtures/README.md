# Activity Fixture Data

This directory contains fixture data for the desirelines web UI. The data is used for demo mode when users are not authenticated, showing realistic activity patterns.

## Directory Structure

```
fixtures/
└── activities/
    └── {year}/
        ├── metadata.json       # Year summary (totals, sports, last_updated)
        ├── metrics/
        │   ├── cycling.json    # Cumulative YTD cycling metrics
        │   ├── running.json    # Cumulative YTD running metrics
        │   └── yoga.json       # Cumulative YTD yoga metrics
        └── source/             # Raw source data (activity details)
            ├── cycling.json
            ├── running.json
            └── yoga.json
```

## Data Formats

### Metrics Files (`metrics/{sport}.json`)

Each metrics file contains an array of **cumulative year-to-date** entries, one per day:

```json
[
  {
    "date": "2025-01-01",
    "distance": 15234.5,
    "elevation": 120.0,
    "time": 2700,
    "activities": 1
  },
  {
    "date": "2025-01-02",
    "distance": 30456.2,
    "elevation": 245.0,
    "time": 5400,
    "activities": 2
  }
]
```

| Field | Description |
|-------|-------------|
| `date` | Date in YYYY-MM-DD format |
| `distance` | Cumulative distance in meters |
| `elevation` | Cumulative elevation gain in meters |
| `time` | Cumulative time in seconds |
| `activities` | Cumulative activity count |

**Note:** Values are cumulative running totals from January 1st.

### Metadata File (`metadata.json`)

Year summary with totals per sport:

```json
{
  "year": 2025,
  "sports": ["cycling", "running", "yoga"],
  "totals": {
    "cycling": {
      "distance_meters": 2955032.9,
      "time_minutes": 9411.5,
      "elevation_meters": 8638.0,
      "activities": 298
    }
  },
  "last_updated": "2025-11-10T12:09:18.722299+00:00",
  "aggregation_version": "1.0"
}
```

## Usage

### Web UI (Demo Mode)

The fixture data is copied to `packages/web/src/data/fixtures/` and bundled with the React app. When users are not authenticated:

1. The app loads fixture data for the current year
2. Data is filtered to only show entries up to the current date
3. This creates the appearance of "live" data that grows daily

### Generating/Updating Fixtures

Fixture data is generated from real Strava data using the aggregator scripts. The data covers the full year (Jan 1 - Dec 31) to support the rolling date filter.

## Available Years

| Year | Sports | Notes |
|------|--------|-------|
| 2023 | cycling, running | Partial year |
| 2024 | cycling, running, yoga | Full year |
| 2025 | cycling, running, yoga | Full year (projected) |
