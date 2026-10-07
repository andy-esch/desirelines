# Route Diagnostics (temporary)

Read-only tools for checking stored route geometry against what Strava has.

> **Temporary.** These measure two known route-geometry problems: routes written
> by the list-endpoint backfill are privacy-trimmed `summary_polyline` geometry,
> and a stopped-then-restarted activity draws a false straight line between its
> legs. Delete this directory once every stored route has been refreshed from
> the detailed polyline and paused routes are stored as separate legs. Nothing
> imports from here.

| Tool | Answers | Cost |
|------|---------|------|
| `compare_route_sources.py` | For one activity: how `map.polyline`, `map.summary_polyline` and the streams differ, and where a pause split would fall | 2 Strava API calls |
| `measure_route_quality.sql` | Across every stored route: how many carry a pause-like jump, and how complete the geometry is | No API calls; wakes Neon compute |

## compare_route_sources.py

Needs a Strava OAuth **access token** (not the client id/secret) with
`activity:read_all` for private activities. Get a short-lived one from
<https://www.strava.com/settings/api>. The script declares its own dependencies
(PEP 723), so `uv run` needs no environment set up:

```bash
export STRAVA_ACCESS_TOKEN="..."
uv run scripts/ops/routes/compare_route_sources.py <strava_activity_id> --out-dir /tmp/route
```

Pass the activity's Strava ID (the number in its Strava URL, or its `strava`
row in `desirelines.activity_external_ids`), not the desirelines activity ID.

It writes `activity_<id>_polyline.geojson` and `activity_<id>_streams.geojson`
for overlaying in a GIS tool, and prints a stream inventory, the gaps found, a
length comparison against the odometer, and whether the polyline alone would
have found the same gaps. `--points` adds per-vertex stream values, `--raw`
keeps the API responses, and `--gap-seconds` / `--gap-meters` tune the split
rule. `--help` lists everything.

## measure_route_quality.sql

```bash
./scripts/database/connect.sh prod --apigateway < scripts/ops/routes/measure_route_quality.sql
```

| Query | Reports | Read it as |
|-------|---------|------------|
| Q1 | Activities whose elapsed time exceeds moving time | An upper bound on pauses; auto-pauses count too |
| Q2 | Routes with a vertex-to-vertex jump over 200/300/500/1000 m, split by whether the route traces longer than the odometer | `corroborated` is a real pause on full-length geometry; on trimmed geometry corroboration fails even for real pauses |
| Q3 | Median vertex spacing and jump rate per route `created_at` date | Coarse spacing marks a summary-polyline cohort |
| Q4 | Traced length ÷ recorded distance per route `created_at` date, and how many routes are stored as more than one leg | Near 1.0 is full-length; well below 1 is trimmed |

**Before/after check for a route refresh:** run it before and after, and compare
Q2 (corroborated jumps should drop to zero once pauses are split) and Q4 (a
trimmed cohort's ratio should rise to about 1.0).

## Tests

```bash
pants test scripts/ops/routes::
```

The tests cover the script's gap detection and geometry helpers on synthetic
tracks; they make no network calls.
