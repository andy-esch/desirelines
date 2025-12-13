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
