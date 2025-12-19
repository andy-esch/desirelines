# BigQuery Schemas

JSON schema definitions for BigQuery tables used by `bq-inserter`.

## Files

| File | Table | Description |
|------|-------|-------------|
| `activities_full.json` | `desirelines.activities` | All Strava activity fields |
| `activities_minimal.json` | `desirelines.activities` | Core fields only (lighter) |
| `deleted_activities.json` | `desirelines.deleted_activities` | Archived deleted activities |

## Usage

Tables are created via Terraform (`terraform/modules/desirelines/bigquery.tf`), which references these schemas.

To output schema in BigQuery CLI format:

```bash
# Full schema (default)
uv run scripts/schema/schema_to_bq.py activities

# Minimal schema
uv run scripts/schema/schema_to_bq.py activities --minimal

# JSON format (for tooling)
uv run scripts/schema/schema_to_bq.py activities --json
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
