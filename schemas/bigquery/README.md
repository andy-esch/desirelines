# BigQuery Schemas

JSON schema definitions for BigQuery tables.

## Files

| File | Table | Description |
|------|-------|-------------|
| `activities_live.json` | `desirelines.activities_live` | The live table, written by the Pub/Sub CDC subscription |
| `activities_full.json` | `desirelines.activities` | All Strava activity fields. Source of truth for the generated protos; the table itself is frozen legacy history |
| `activities_minimal.json` | `desirelines.activities` | Core fields only (lighter). Used only by `schema_to_bq.py --minimal` |

## Usage

`activities_full.json` is the source of truth from which `generate_proto.py`
derives the protobuf profiles — including the CDC topic schema that Pub/Sub
validates published rows against. It is also the schema the backfill job's
staging + MERGE path writes.

To output schema in BigQuery CLI format:

```bash
# Full schema (default)
uv run schemas/bigquery/scripts/schema_to_bq.py activities

# Minimal schema
uv run schemas/bigquery/scripts/schema_to_bq.py activities --minimal

# JSON format (for tooling)
uv run schemas/bigquery/scripts/schema_to_bq.py activities --json
```

## Schema Format

```json
{
  "schema": [
    {"name": "id", "type": "INTEGER", "mode": "REQUIRED"},
    {"name": "name", "type": "STRING", "mode": "NULLABLE"},
    ...
  ]
}
```

Fields follow [BigQuery schema format](https://cloud.google.com/bigquery/docs/schemas).

`generate_proto.py` also converts `activities_full.json` to
`schemas/proto/desirelines/bigquery/v1/bq_activities.proto` (run via
`just sync-schemas`). Every non-repeated field gets `optional` in the
generated proto regardless of BQ `mode` — per BQ Storage Write API
guidance, BQ enforces `REQUIRED` server-side at insert time. So a
`REQUIRED ↔ NULLABLE` change in JSON does not regenerate the proto.

Any activity-field change must also update the
[persisted activity compatibility contract](../activities/). That contract
records whether detailed webhook and summary backfill sources can supply the
field, whether summary serialization excludes it, and what historical-data
action is required. It does not replace this JSON schema as the BigQuery
source of truth.

## REQUIRED vs NULLABLE — gotchas

- Default to `NULLABLE` unless the field really is always present.
  Metrics that don't apply to every activity (`distance`,
  `total_elevation_gain`, `average_speed`, `max_speed`) **must** be
  NULLABLE: yoga / weight-training / indoor activities legitimately
  lack them, and `REQUIRED` rejects those inserts.
- BigQuery **cannot** change a column's mode in place. Once a table is
  created with `REQUIRED`, the only path to `NULLABLE` is a
  table-recreate (procedure below).
- Adding a new `NULLABLE` column to an existing table *is* in-place
  compatible (`bq update --schema`). Adding `REQUIRED` is not.

## Changing REQUIRED → NULLABLE on a deployed table

After merging the JSON change, run this against the live dataset. Nothing in the
pipeline holds DDL rights by design, so this is a human-operator step.

**Pausing writes is different now.** This procedure was written when a Cloud Run
service wrote the table and could be scaled to zero. `activities_live` is written
by a Pub/Sub BigQuery subscription, which has no instance count — to stop writes
you have to detach the subscription (the topic retains messages for its retention
window) and recreate it afterwards, which for a Terraform-managed subscription
means a module change and a deploy. Weigh that against simply letting writes
dead-letter during a short swap and replaying them.

```bash
export PROJECT=<gcp-project-id>
export DATASET=<bq-dataset>
export TABLE=activities
export SCHEMA=schemas/bigquery/${TABLE}.json     # or activities_full.json

# 1. Create the new table with the corrected schema
bq mk --table --schema "$SCHEMA" "${PROJECT}:${DATASET}.${TABLE}_new"

# 2. Copy the data over
bq query --use_legacy_sql=false --destination_table \
  "${PROJECT}:${DATASET}.${TABLE}_new" --replace \
  "SELECT * FROM \`${PROJECT}.${DATASET}.${TABLE}\`"

# 3. Verify row counts match — STOP if they don't
bq query --use_legacy_sql=false --format=csv \
  "SELECT
     (SELECT COUNT(*) FROM \`${PROJECT}.${DATASET}.${TABLE}\`)     AS old_rows,
     (SELECT COUNT(*) FROM \`${PROJECT}.${DATASET}.${TABLE}_new\`) AS new_rows"

# 4. Atomic swap. Stop writes first if the table is one the CDC subscription
#    writes (see the note above on detaching the subscription).
bq rm -f -t "${PROJECT}:${DATASET}.${TABLE}"
bq cp -f "${PROJECT}:${DATASET}.${TABLE}_new" "${PROJECT}:${DATASET}.${TABLE}"
bq rm -f -t "${PROJECT}:${DATASET}.${TABLE}_new"
```

If anything looks wrong before the rm/cp swap, the `_new` table holds
the migrated data — no recovery needed. After the swap, recover via
`bq cp "${PROJECT}:${DATASET}.${TABLE}@-3600000"` (1h time-travel
snapshot) if you need to roll back.
