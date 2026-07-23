# Data Scripts

One-off operational scripts for populating reference data.

> **Historical backfill is not done here.** Activity, route, and region-tag
> backfill is handled by the `desirelines-backfill` Cloud Run Job
> (`packages/stravapipe/src/stravapipe/cloudrun/backfill_job.py`), which fetches
> from Strava, decodes polylines into `activity_routes`, and reconciles
> `activity_regions` per activity. The standalone BigQuery→PostgreSQL and
> route-tagging scripts that used to live here were retired once the job
> subsumed them.

## Script Index

| Script                                           | Purpose                                                         | Status    |
| ------------------------------------------------ | --------------------------------------------------------------- | --------- |
| [`load_census_regions.py`](#load-census-regions) | Load US Census CBSA + county boundaries → `desirelines.regions` | ✅ Active |

---

## Load Census Regions

**Script**: `load_census_regions.py`

Populates the `desirelines.regions` boundary reference table (added in migration
`V0005`) that the routes-map feature spatial-joins activity routes against. This
is a *reference-data* loader, not an activity backfill: the Cloud Run job tags
activities against `regions`, but something has to load `regions` first, and
that is this script (re-run per Census vintage). Loads two US Census
cartographic boundary layers and classifies them into a CBSA → county cascade:

- **CBSA** (`cb_<vintage>_us_cbsa_500k`) → `region_kind` `cbsa_metro` / `cbsa_micro`,
  split on the `LSAD` attribute (`M1` = metropolitan, `M2` = micropolitan; both
  ship in one file).
- **County** (`cb_<vintage>_us_county_500k`) → `region_kind` `county`, the
  fallback for the rural areas CBSAs don't cover.

Geometries are repaired and coerced to `MULTIPOLYGON` on insert
(`ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(…)), 3))`). The
whole load runs in a single transaction, so `--replace` reloads are atomic.

This is the **US-only placeholder** dataset; `regions` is source-agnostic
(`source` + `region_kind` columns), so a global boundary dataset can be loaded
the same way later under new `source` values without a schema change.

Uses [uv inline script dependencies](https://docs.astral.sh/uv/guides/scripts/#declaring-script-dependencies)
(`pyshp` + `psycopg`) — no workspace setup needed.

### Usage

```bash
# Set connection string (admin/owner role — this writes the regions reference table)
export POSTGRES_CONNECTION_STRING="postgresql://user:pass@host/db?sslmode=require"

# Dry run (download + parse, report metro/micro/county counts, insert nothing)
uv run scripts/ops/backfills/load_census_regions.py --dry-run

# Load (idempotent: ON CONFLICT DO NOTHING)
uv run scripts/ops/backfills/load_census_regions.py

# Clean reload of both layers (delete each source's rows first), or a newer vintage
uv run scripts/ops/backfills/load_census_regions.py --replace
uv run scripts/ops/backfills/load_census_regions.py --vintage 2023 --replace
```

### Requirements

- `POSTGRES_CONNECTION_STRING` (admin connection — the table is owned by the DDL
  role; the runtime app only reads `regions`)
- PostgreSQL with PostGIS and the `desirelines.regions` table (migration `V0005`)
- Network access to `www2.census.gov`

---

## Related Documentation

- [Domain Model](../../../docs/architecture/domain-model.md)
- [PubSub Subscription Design](../../../docs/architecture/pubsub-subscription-design.md)
