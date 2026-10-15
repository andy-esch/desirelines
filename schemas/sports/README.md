# Sport Types Configuration

`sport_types.json` defines Desirelines sport categories, their metrics and mappings
from incoming classification vocabularies. Only Strava activities are supported.

## Purpose

- Frontend uses this as the definitive list of supported sport categories
- Maps the `strava.sport_type` vocabulary to app categories (e.g., "Run", "TrailRun", "VirtualRun" -> "running")
- Defines which metrics are displayed per category (distance, elevation, time)

## Strava SportType

See the [Strava API SportType enum](https://developers.strava.com/docs/reference/#api-models-SportType)
for the upstream vocabulary; `just check-upstream-sports` checks it for drift.

The database stores Strava's `sport_type` as-is without validation. Filtering to supported types happens at the application layer using this config.

## Schema

The internal registry uses version `2.0`. Property names are camelCase; category
IDs and metric values retain their existing spelling. A mapping key such as
`strava.sport_type` identifies the vocabulary of the field being interpreted.
It is separate from the service used to retrieve an activity and its reported
origin. Other vocabularies require explicit integration support when added;
the loaders currently require exactly the Strava mapping for each category.

```json
{
  "version": "2.0",
  "sportCategories": {
    "<category_key>": {
      "displayName": "Human readable name",
      "mappings": {
        "strava.sport_type": {
          "types": ["StravaType1", "StravaType2"],
          "excludedTypes": ["ExcludedType"]
        }
      },
      "primaryMetric": "distance_meters|time_minutes",
      "metrics": ["distance_meters", "time_minutes", ...],
      "hasDistance": true|false,
      "hasElevation": true|false,
      "dangerPace": { "valuePerDay": 20, "unit": "miles" },
      "goalDefaults": {
        "increment": 10,
        "rounding": 10,
        "defaultValue": 1000,
        "chartIntervals": [
          { "max": 200, "interval": 50 },
          { "interval": 500 }
        ]
      }
    }
  }
}
```

`dangerPace` is optional. The frontend reads it to draw the sustainable-pace
"danger zone" on charts; backends ignore it. `unit` must be one of
`miles | kilometers | meters | feet | hours | minutes | sessions` — the value
is converted into the user's preferred display unit at read time, so always
state it in whatever unit is most natural to maintain (e.g. `miles` for the US
default, `hours` for time sports). The optional `warnAtFraction` (0–1, default
`0.75`) sets how close to the threshold the pacing chart's danger-zone overlay
appears — higher warns later; e.g. yoga uses `0.9` because 2 hr/day is more
achievable than a distance sport's ceiling.

`goalDefaults` is optional per-sport goal tuning read by the web client's
`getMetricConfig`; backends load and pass it through without interpreting it.
Every field is optional and inherits the base config for the sport's
`primaryMetric` when omitted — so a sport whose defaults match its base type
needs no entry at all. Fields: `increment` (goal +/- step), `rounding`
(goal-value rounding factor), `defaultValue` (goal when a sport has no
activities yet), and `chartIntervals` (Y-axis tick thresholds). Values are in
the display unit of the sport's `primaryMetric` (miles for distance sports,
hours for time sports). In `chartIntervals`, the final catch-all bucket omits
`max` (JSON has no `Infinity`); the client restores it as `Infinity`.

## Consumers

`just sync-schemas` copies the registry to the Go and Python packages. The web
reads a compatible projection from `/v1/sports/config`: version `1.0`, with
`stravaTypes` and `excludedTypes` derived from `mappings["strava.sport_type"]`.
Category metadata passes through unchanged. The internal registry is not served
directly, so existing settings, map styles and cached clients keep their contract.

| Field | apigateway (Go) | stravapipe (Python) | web (TypeScript) |
|-------|-----------------|---------------------|-------------------|
| `mappings["strava.sport_type"].types` | Query filters, reverse categorization map; projects `stravaTypes` | Matches incoming activities via `matches()` | API `stravaTypes`: settings labels/search and map colors |
| `mappings["strava.sport_type"].excludedTypes` | Projects `excludedTypes` | Used in `matches()` filtering | Retained in API contract |
| `displayName` | Loaded | Loaded | Sport labels in UI |
| `primaryMetric` | Loaded, passed through | Loaded | Metric selection |
| `metrics` | Loaded | Loaded | Chart configuration |
| `hasDistance` | Loaded, passed through | Loaded | — |
| `hasElevation` | Loaded, passed through | Loaded | — |
| `dangerPace` | Loaded, passed through | Loaded, ignored | Danger-zone rendering in charts |
| `goalDefaults` | Loaded, passed through | Loaded, ignored | Per-sport goal tuning in `getMetricConfig` |

**Note:** The backend packages (`apigateway`, `stravapipe`) are synced automatically via `just sync-sport-config`. The web app reads this config from the public `/sports/config` endpoint — there is no separate synced web fixture. The one remaining **manual-sync** surface is the demo data generator's `DEMO_SPORT_CONFIG` (`packages/web/src/constants/demoConfig.ts`), which still hard-codes per-sport metadata (Strava types, primary metric) and must be updated by hand when adding a sport.

`testdata/config-v1.json` freezes the pre-v2 public config for compatibility tests.
Go compares the entire projected response and every forward/reverse mapping to it;
Python checks all type memberships/exclusions and TypeScript validates the shared
public contract. Keep this fixture independent of schema sync. Intentional future
category or metadata changes must explicitly update the compatibility expectation.

### Source files

- **apigateway**: `config/sport_config.go`, `internal/sports/handler.go`
- **stravapipe**: `stravapipe/config/sport_config.py`
- **web**: `api/activities.ts` (type definition), `utils/sportConfig.ts` (field access)

## Unknown Sport Detection

Strava adds new `SportType` enum values upstream from time to time. To
prevent activities from silently disappearing or being miscategorized when
that happens, the system has two layers of protection:

1. **`other` fallback category** — Any `sport_type` not explicitly listed
   in the Strava mapping's `types` lands in the `other` bucket so
   the user still sees the activity in the UI. The sentinel
   `"__unmapped_sport_type__"` in `other.mappings["strava.sport_type"].types` is a placeholder that
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
   `schemas/sports/sport_types.json`, under `mappings["strava.sport_type"].types`.
   If none fit (e.g., a
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
