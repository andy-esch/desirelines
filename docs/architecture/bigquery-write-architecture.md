# BigQuery Write Architecture

How activities get written to BigQuery, and the decision to move that write off
application code and onto a Pub/Sub BigQuery subscription in CDC mode. For the
store-relationship contract (PostgreSQL is source of truth, BigQuery is an
archival mirror) see
[PostgreSQL ↔ BigQuery Consistency](postgres-bigquery-consistency.md).

**Status:** accepted and implemented. The CDC subscription is the only path by
which live activity rows reach BigQuery in dev and prod; the `bq-inserter`
service, its subscription, service account and DLQ wiring are deleted. The
legacy `activities` and `activities_staging` tables still exist, holding their
history, but are no longer written by the live path and are no longer managed by
Terraform — see "What actually shipped" below.

## Context — the write path this replaced

An activity used to reach BigQuery through application code:

`activity_events` topic → push subscription → `bq-inserter` Cloud Run service →
Storage Write API → `activities_staging` → `MERGE` into `activities`; deletes ran
a `DELETE` DML.

That worked but carried avoidable cost and risk:

- A whole Cloud Run service + Storage Write API plumbing (`AppendRowsStream`,
  descriptor flattening) existed only to write rows.
- The MERGE column list was hand-maintained and had drifted from the schema
  before.
- The delete path's archive + delete were two operations with no shared
  transaction — not atomic.
- Out-of-order/redelivered events were resolved with a `ROW_NUMBER` tiebreak in
  the MERGE rather than a first-class ordering key.
- BigQuery is archival — no product read path depends on it — so this was all
  background work whose failures were invisible until inspected.

## Decision

Write activities to BigQuery with a **Pub/Sub BigQuery subscription in CDC
mode**, from a **schema-bound topic whose schema is the activity row itself**
(the `bq_activity_rows` proto — a second profile generated from the same
BigQuery table schema as `bq_activities`, which stays as it is because the
Storage Write API and the Pub/Sub subscription want different encodings). Pub/Sub writes rows directly to BigQuery; there is
**no subscriber service, no staging table, no MERGE, no DML**.

Two tables:

| table | subscription | write shape |
|---|---|---|
| `activities_live` | CDC BigQuery subscription, primary key `id` | `_CHANGE_TYPE = UPSERT` on create/update, `_CHANGE_TYPE = DELETE` on delete, ordered by `_CHANGE_SEQUENCE_NUMBER` — hex sections, the webhook `event_time` then a local tiebreak for events Strava stamped in the same second |
| `activities_log` (**not built** — see below) | plain append BigQuery subscription, no key | every event, append-only; the "deleted set" would be derivable as `log ANTI JOIN live` |

Deletes are first-class (a `DELETE` change message). Out-of-order and redelivered
events resolve to the newest by `_CHANGE_SEQUENCE_NUMBER`, so **no
application-side event-time fence is needed on the BigQuery side** — the platform
orders the changes.

This is proven before cutover: run the new pipeline **in parallel** on new tables
(nothing reads them) via a flagged, best-effort dual-publish, compare against
PostgreSQL, then cut over and retire the old path.

## Why this wins

- **Deletes the writer.** No `bq-inserter` service, no Storage Write API code, no
  staging, no MERGE, no `_MERGE_COLUMNS`, no delete DML.
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
  the subscription needs a full activity *row* conforming to the topic schema,
  plus the CDC keys. That mapping is the main new code, added as a flagged
  best-effort second publish that can never affect the primary path.
- **Eventual consistency.** CDC apply is not instantaneous (seconds), which is
  fine for an archival store.
- **Cutover retires** the old service. It did not seed history — see below.

## What actually shipped

The decision above landed, with three deliberate deviations worth recording so
the gap between this document and the code is intentional rather than rot.

**`activities_log` was not built.** No product read path touches BigQuery at all,
so an append-only table with no reader was speculative. The one thing it would
have bought — the `log ANTI JOIN live` deleted-set query — is something nobody
runs. It stays in the design above because it remains the right shape if a
consumer ever appears. Note the cost of waiting: topic retention is 7 days, so
events not captured into a log now are not recoverable into one later.

**History was not seeded.** `activities_live` starts from the cutover, not from
the beginning of time; the legacy `activities` table is frozen at the rows it
had. The plan was to seed by having the backfill publish rows to the topic, but
the Strava-activity-to-CDC-row mapping exists only in Go (in the dispatcher),
and the backfill job is Python — so doing it would mean a second implementation
of that mapping and a standing drift risk. That decision is parked pending a
separate question about whether the Python services move to Go, which would make
the mapping available for free.

**The writer is not fully deleted.** "Deletes the writer" above is true of the
live path only. `ActivitiesWriter`, `_MERGE_COLUMNS` and the Storage Write API
staging code survive because the **backfill job** still uses them to write the
legacy `activities` table. So backfill currently MERGEs into a table nothing
reads — harmless, but the reason that code is still here.

**The legacy tables were orphaned, not dropped.** `activities` and
`activities_staging` still exist in both projects with their data, but are no
longer Terraform-managed (dropped from state with `removed { … destroy = false }`
so their history survived). They come out by hand with `bq rm` when the history
is no longer wanted. Do not re-add them as Terraform resources — a create would
be planned against tables that already exist and fail.

## What the open questions resolved to

Recorded here because several answers were counter-intuitive and two were
originally guessed wrong.

- **Nested schema mapping works.** Segment efforts, laps, splits, best efforts,
  the `map` and `photos` records and the `JSON` column all map end-to-end,
  verified by publishing a real Strava payload through a schema-bound topic into
  a CDC subscription. No schema simplification was needed.
- **TIMESTAMP travels as a string.** The Pub/Sub proto→BigQuery mapping accepts
  a proto `string` for a `TIMESTAMP` column provided the value is a valid
  BigQuery timestamp, which Strava's RFC 3339 already is. So the CDC profile
  declares timestamps as `string` and the producer forwards them untouched —
  unlike the Storage Write profile, which requires int64 micros.
- **The CDC keys are message body fields**, not attributes.
  `_CHANGE_SEQUENCE_NUMBER` is hex sections separated by `/`, compared as
  unsigned numbers.
- **`photos.urls` must be JSON *text*, not a nested object.** The original note
  here said the opposite. Sending the object BigQuery rejects the whole message
  with `JSON Object: 'urls' is incompatible with BigQuery field 'urls' of type
  JSON`, which silently dropped every activity that had a photo until it was
  found in the dead-letter queue. BigQuery parses the text back into an object
  on arrival, so the stored shape is the same either way.
- **Partial updates are re-fetched, not skipped.** A title-only webhook carries
  no activity payload, and a CDC `UPSERT` replaces the whole row. The row
  publisher re-fetches the activity rather than skipping, so metadata edits
  reach the table. The fetch is deliberately inside the best-effort block and
  bounded by its own short timeout, so it cannot enrich the primary envelope or
  spend the webhook's response budget.
- **The table can declare no REQUIRED column but the key.** Under
  `use_topic_schema` Pub/Sub compares the two schemas statically, and every
  proto2 field is `optional`, so a REQUIRED column at any depth is incompatible.
  The key stays REQUIRED and the proto labels it `required` to match; everything
  else is relaxed.

## Known limits

- **Freshness is bounded by Strava's webhook surface.** Strava sends activity
  update events for title, type and privacy changes only. A photo, description
  or gear change with no accompanying edit of those three produces no event, so
  it does not reach `activities_live` until some later event for that activity.
- **Schema changes need the topic schema replaced, not revised.** Pub/Sub
  rejects an incompatible schema revision in either direction — adding a
  required field and removing one alike — so the schema resource carries a
  digest of its definition in its name and a changed definition becomes a new
  schema at revision 1.
- **Field completeness** is bounded by what the producer holds — the same
  constraint the retired `bq-inserter` had: detailed-only fields depend on the
  enrichment fetch.

## Related

- [PostgreSQL ↔ BigQuery Consistency](postgres-bigquery-consistency.md)
- [Pub/Sub Subscription Design](pubsub-subscription-design.md)
