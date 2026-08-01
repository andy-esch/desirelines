# BigQuery Write Architecture

How activities get written to BigQuery, and the decision to move that write off
application code and onto a Pub/Sub BigQuery subscription in CDC mode. For the
store-relationship contract (PostgreSQL is source of truth, BigQuery is an
archival mirror) see
[PostgreSQL ↔ BigQuery Consistency](postgres-bigquery-consistency.md).

**Status:** accepted; being proven via an isolated parallel prototype in
production before any cutover.

## Context — the current write path

Today an activity reaches BigQuery through application code:

`activity_events` topic → push subscription → `bq-inserter` Cloud Run service →
Storage Write API → `activities_staging` → `MERGE` into `activities`; deletes run
a separate archive DML (`INSERT INTO deleted_activities SELECT … FROM activities`)
plus a `DELETE`.

This works but carries avoidable cost and risk:

- A whole Cloud Run service + Storage Write API plumbing (`AppendRowsStream`,
  descriptor flattening) exists only to write rows.
- The MERGE column list is hand-maintained and has drifted from the schema
  before.
- The delete path's archive + delete are two operations with no shared
  transaction — not atomic.
- Out-of-order/redelivered events are resolved with a `ROW_NUMBER` tiebreak in
  the MERGE rather than a first-class ordering key.
- BigQuery is archival — no product read path depends on it — so this is all
  background work whose failures are invisible until inspected.

## Decision

Write activities to BigQuery with a **Pub/Sub BigQuery subscription in CDC
mode**, from a **schema-bound topic whose schema is the activity row itself**
(the `bq_activities` proto). Pub/Sub writes rows directly to BigQuery; there is
**no subscriber service, no staging table, no MERGE, no DML**.

Two tables:

| table | subscription | write shape |
|---|---|---|
| `activities_live` | CDC BigQuery subscription, primary key `id` | `_CHANGE_TYPE = UPSERT` on create/update, `_CHANGE_TYPE = DELETE` on delete, ordered by `_CHANGE_SEQUENCE_NUMBER` = the webhook `event_time` |
| `activities_log` (added at cutover) | plain append BigQuery subscription, no key | every event, append-only; the "deleted set" is derivable as `log ANTI JOIN live` |

Deletes are first-class (a `DELETE` change message). Out-of-order and redelivered
events resolve to the newest by `_CHANGE_SEQUENCE_NUMBER`, so **no
application-side event-time fence is needed on the BigQuery side** — the platform
orders the changes.

This is proven before cutover: run the new pipeline **in parallel** on new tables
(nothing reads them) via a flagged, best-effort dual-publish, compare against
PostgreSQL, then cut over and retire the old path.

## Why this wins

- **Deletes the writer.** No `bq-inserter` service, no Storage Write API code, no
  staging, no MERGE, no `_MERGE_COLUMNS`, no `deleted_activities` archive DML.
- **Atomic by construction.** Pub/Sub writes via the Storage Write API; the
  non-atomic archive-then-delete problem disappears rather than being worked
  around.
- **Ordering + deletes are native**, not emulated in SQL.
- **Schema drift closes**: the topic schema *is* the table schema, so a field
  can't be present in one and missing from the other (the create/update
  subscription workflow rejects incompatible schemas outright).
- **Failure handling is built in**: failed writes are negatively acknowledged and
  retried with backoff, and a dead-letter topic captures messages that can't be
  written (with a `…DeliveryErrorMessage` attribute).

## Alternatives considered

- **Keep staging + MERGE (status quo).** Rejected: keeps the service, the column
  drift, and the non-atomic delete.
- **Application-side Storage Write API CDC** (write `_CHANGE_TYPE` from our own
  code, skip staging/MERGE). Better than status quo, but still a writer service
  and still needs client injection to be testable. The platform subscription
  gets the same CDC semantics with no code.
- **Append-only log + a derived `live` view** (no CDC at all). Viable and clean,
  but a CDC subscription gives a real, queryable `live` table for free; we keep
  the append `log` for history and get `live` as a maintained table rather than a
  query-time projection.

## Consequences / trade-offs

- **At-least-once delivery** (no exactly-once). For `live`, duplicates and
  reorders are idempotent via the sequence number. For `log`, duplicates are
  acceptable signal.
- **The producer changes.** The dispatcher publishes a webhook *envelope* today;
  the subscription needs a full activity *row* conforming to the `bq_activities`
  schema, plus the CDC keys. That mapping (and generating the proto for Go) is
  the main new code, added as a flagged best-effort second publish that can never
  affect the primary path.
- **Eventual consistency.** CDC apply is not instantaneous (seconds), which is
  fine for an archival store.
- **Cutover retires** the old service and tables; history is seeded by having the
  backfill publish rows to the topic (which is also how BigQuery backfill gets
  re-enabled — the current table was never backfilled).

## Open questions (resolved downstream, not here)

- **Full nested schema mapping is the load-bearing risk.** Nested messages map to
  `RECORD`, repeated to `REPEATED`, and our proto has no `oneof` (the one
  unmappable construct) — but whether the deeply-nested activity (segment efforts,
  laps, splits, best efforts, the `map` and `photos` records, the one `JSON`
  column) maps cleanly end-to-end is only proven by a smoke test. *Resolved in the
  infra task; if it can't map, the fallback is to simplify `live`'s schema (heavy
  nested arrays are optional for archival analysis) or store them as `JSON`.*
- **Partial / bare updates.** Title/type-only webhooks carry no full activity; a
  CDC `UPSERT` replaces the whole row, so a partial would clobber columns. The
  prototype skips them; the policy (skip-and-resync vs force-refetch) is decided
  from parallel-run data.
- **CDC key mechanism.** Whether `_CHANGE_TYPE` / `_CHANGE_SEQUENCE_NUMBER` are
  message attributes or fields, and the sequence-number format — pinned by the
  infra smoke test.
- **Field completeness parity.** The row is only as complete as what the producer
  has (same constraint as the current `bq-inserter`); detailed-only fields depend
  on the enrichment fetch. Validate parity with today during the parallel run.
- **JSON column** (`photos.urls`): emit `null`/omit, never `""`.

## Related

- [PostgreSQL ↔ BigQuery Consistency](postgres-bigquery-consistency.md)
- [Pub/Sub Subscription Design](pubsub-subscription-design.md)
