# Persisted Activity Compatibility

`persisted_activity_contract.json` records how every modelled activity field
behaves in the live webhook pipeline, summary/list backfill, PostgreSQL, and
BigQuery. It is a test-time policy manifest: production services do not load it.

The executable checks live in
`packages/stravapipe/tests/unit/test_activity_persistence_contract.py`. They
derive inventories from the Pydantic models, PostgreSQL write mapping, and
generated BigQuery descriptor. A field added to any of those surfaces fails CI
until this manifest records its disposition.

## Contract Boundaries

No one schema owns the activity across every stage:

| Contract | Authority |
| -------- | --------- |
| `webhook.proto` | Cross-language event metadata and update presence |
| `EnrichedEvent.raw_activity` | Opaque detailed Strava JSON |
| `DetailedStravaActivity` | Detailed Strava source validation |
| `SummaryStravaActivity` | Strava list/backfill source validation |
| `StandardActivity` | PostgreSQL application projection |
| Flyway migrations | PostgreSQL schema |
| `activities_full.json` | BigQuery table schema |
| Generated `bq_activities.proto` | BigQuery Storage Write row descriptor |
| `activities.proto` | Apigateway/frontend read DTOs |

The generated protobuf descriptors are strong destination and transport
contracts, but they are not a universal persisted-activity model.

## Dispositions

Each top-level source or destination field has:

- `detailed` and `summary`: whether that Strava response shape supplies it.
- `postgres`: a direct column, derived column, route/geography outcome, or
  intentional non-persistence.
- `bigquery`: a descriptor column, intentional summary exclusion, or
  intentional non-persistence.
- `live`: which webhook path can write it.
- `backfill`: whether summary/list backfill writes, derives, preserves, leaves
  unavailable, or obtains it from another source.
- `reason`: required for every unavailable, excluded, derived, or otherwise
  asymmetric outcome.

`nested_differences` records asymmetric fields within shared records. For
example, detailed `map.polyline` is unavailable from the list endpoint, while
both shapes can supply `map.summary_polyline`.

Representative mappings:

- `sport_type` becomes computed `StandardActivity.sport`, then
  `desirelines.activities.sport`.
- `athlete.id` becomes computed `StandardActivity.user_id`, then
  `desirelines.activities.user_id`.
- `start_date_local` writes its column and derives
  `desirelines.activities.year`.
- `map` is not an activities-table column. It produces
  `desirelines.activity_routes.route` and drives region reconciliation.
- `hide_from_home` is written by detailed CREATE ingestion to BigQuery, but the
  summary endpoint cannot supply it, so backfill records
  `leave_unavailable`.

`leave_unavailable` describes source capability; it does not promise that a
BigQuery MERGE preserves a previously populated value. BigQuery backfill
reenablement and cross-source MERGE preservation require their own
write-ordering policy and behavior tests.

## Persisted-Field Change Checklist

For every persisted activity-field change:

1. Update the relevant Pydantic source model in
   `packages/stravapipe/src/stravapipe/domain/activity.py`.
2. Record detailed and summary availability in
   `persisted_activity_contract.json`.
3. Record live behavior, including CREATE, enriched UPDATE, and bare metadata
   UPDATE differences where applicable.
4. Record backfill behavior: `write`, `derive`, `leave_unavailable`,
   `preserve`, `alternate_source`, or `not_applicable`.
5. For PostgreSQL, update the Flyway migration and the ordered
   `_ACTIVITY_COLUMN_ATTRIBUTES` mapping, or record a route/geography or
   non-persistence outcome.
6. For BigQuery, update `activities_full.json`, regenerate the Storage Write
   proto, verify serialization and MERGE coverage, or record an exclusion.
7. Update the canonical raw activity fixture when the field needs a regression
   value. Validate that one fixture through both source models when the field
   is shared rather than copying shared values into a second JSON document.
8. Record exactly one historical-data outcome from the list below.
9. Run the focused contract test and the repository validation commands.

## Historical-Data Outcome

Every change must choose exactly one:

- `no_historical_action`: explain why existing rows remain correct.
- `normal_backfill_rerun`: identify the environment or population to rerun.
- `schema_migration`: name the Flyway and/or BigQuery migration operation.
- `dedicated_repair`: link the repair task or script.

A normal backfill rerun must be considered, but it is not automatically the
correct action.

## Validation

```bash
just py-test tests/unit/test_activity_persistence_contract.py
just py-test
just py-lint
just py-typecheck
just verify-schemas
just proto-lint
just proto-fmt-check
git diff --check
```
