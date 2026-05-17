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

**Note:** The backend packages (`apigateway`, `stravapipe`) are synced automatically via `just sync-sport-config`. The web package's demo fixture (`packages/web/src/data/fixtures/index.ts`) must be updated **manually** to match this file.

### Source files

- **apigateway**: `config/sport_config.go`, `internal/config/handler.go`
- **stravapipe**: `stravapipe/config/sport_config.py`
- **web**: `api/activities.ts` (type definition), `utils/sportConfig.ts` (field access)

## Unknown Sport Detection

Strava adds new `SportType` enum values upstream from time to time. To
prevent activities from silently disappearing or being miscategorized when
that happens, the system has two layers of protection:

1. **`other` fallback category** — Any `sport_type` not explicitly listed
   in `stravaTypes` (or `excludedTypes`) lands in the `other` bucket so
   the user still sees the activity in the UI. The sentinel
   `"__unmapped_sport_type__"` in `other.stravaTypes` is a placeholder that
   satisfies the `min=1` schema validator — real Strava webhooks never
   send that value; the category is populated by the fallback path.

2. **`Unknown Strava sport_type detected` log + alert** — Both
   `apigateway` (Go) and `stravapipe` (Python) emit a structured `WARNING`
   log the first time a process encounters an unmapped type, with the
   value attached as `unmapped_sport_type`. The GCP log-based metric
   `${project}_${env}_unknown_sport_type` counts these and the alert
   `Strava sport_type detected with no registry mapping` pages on the
   first occurrence.

### Reconciling a fired alert

1. Read the `unmapped_sport_type` label from the alert (e.g.,
   `HighIntensityIntervalTraining`).
2. Cross-check against Strava's current enum:

   ```bash
   just check-upstream-sports
   ```

   That script downloads `https://developers.strava.com/swagger/swagger.json`,
   extracts the `SportType` enum, and diffs it against this file. It also
   surfaces any other drift you may not have been alerted about yet.

3. Add the value to the most-appropriate category in
   `schemas/sports/sport_types.json`. If genuinely none fit (e.g., a
   brand-new Strava niche we don't track), leaving it in `other` is fine.

4. Sync and verify:

   ```bash
   just sync-schemas
   just verify-schemas
   ```

5. Ship a PR. The alert auto-closes 1h after the last firing.

### CI mode

`just check-upstream-sports --strict` exits non-zero on drift. Suitable
for a scheduled CI job that posts to Slack or opens an issue when Strava
ships a new sport before we register it.

## Related

- [Domain Model](../../docs/architecture/domain-model.md) — see "Sport Configuration" section for how this config maps to types in each package
- `terraform/modules/desirelines/monitoring.tf` — log-based metric +
  `unknown_sport_type_detected` alert policy.
- `scripts/ops/check-strava-sports.py` — upstream diff tool.
