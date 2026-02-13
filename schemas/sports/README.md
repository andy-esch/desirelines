# Sport Types Configuration

`sport_types.json` defines the sports supported by the frontend and their metrics.

## Purpose

- Frontend uses this as the definitive list of supported sport categories
- Maps Strava's `sport_type` values to app categories (e.g., "Run", "TrailRun", "VirtualRun" -> "running")
- Defines which metrics are displayed per category (distance, elevation, time)

## Strava SportType

Strava has ~50 sport types. See [Strava API SportType enum](https://developers.strava.com/docs/reference/#api-models-SportType).

The database stores Strava's `sport_type` as-is without validation. Filtering to supported types happens at the application layer using this config.

## Schema

```json
{
  "sport_categories": {
    "<category_key>": {
      "display_name": "Human readable name",
      "strava_types": ["StravaType1", "StravaType2"],
      "excluded_types": ["ExcludedType"],
      "primary_metric": "distance_meters|time_minutes",
      "metrics": ["distance_meters", "time_minutes", ...],
      "has_distance": true|false,
      "has_elevation": true|false
    }
  }
}
```

## Consumers

This file is synced to three packages via `just sync-schemas`. Each consumer depends on different fields — don't remove a field without checking all three.

| Field | apigateway (Go) | stravapipe (Python) | web (TypeScript) |
|-------|-----------------|---------------------|-------------------|
| `strava_types` | Builds reverse lookup map for categorization | Matches incoming activities via `matches()` | — |
| `excluded_types` | Loaded | Used in `matches()` filtering | — |
| `display_name` | Loaded | Loaded | Sport labels in UI |
| `primary_metric` | Returned via `GetCategory()` | Loaded | Metric selection |
| `metrics` | Loaded | Loaded | Chart configuration |
| `has_distance` | Returned via `GetCategory()` | Loaded | — |
| `has_elevation` | Returned via `GetCategory()` | Loaded | — |

**Note:** The apigateway also serves the entire config as raw JSON via `/sports/config`, so the web frontend receives all fields even if it only actively uses a subset.

### Source files

- **apigateway**: `config/sport_config.go`, `internal/config/handler.go`
- **stravapipe**: `stravapipe/config/sport_config.py`
- **web**: `api/activities.ts` (type definition), `utils/sportConfig.ts` (field access)
