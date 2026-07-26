# PostgreSQL ↔ BigQuery Consistency

How the two activity stores relate, why they can diverge, and what (does and
does not) reconcile them. This is the **contract** doc; for the delivery
mechanics that create the divergence window see
[Pub/Sub Subscription Design](pubsub-subscription-design.md).

## The contract

- **PostgreSQL is the single source of truth.** Every product/API read path is
  served from PostgreSQL. It is authoritative for activity state.
- **BigQuery is an archival / analytics mirror of PostgreSQL.** It exists for
  historical analysis, not to serve the product. Full parity with PostgreSQL is
  the intended steady state, but BigQuery **may lag or diverge** from PostgreSQL
  and that is an accepted, bounded condition — not a bug — because no product
  read path trusts BigQuery.
- **The backfill job is the reconciliation mechanism.** Re-running the
  per-athlete/per-year backfill re-projects history into a store. There is no
  separate per-id reconciler (see "Escalation" below).

## Why the two stores diverge

`activity_events` fans out to **two independent Pub/Sub push subscriptions** —
one for `postgres-writer`, one for `bq-inserter` — each with its **own** dead
letter queue and 5-attempt retry policy
(`terraform/modules/desirelines/pubsub_subscriptions.tf`). The two writes are not
transactional with each other, so a single event can:

- **dead-letter on one subscription while committing on the other** — e.g. a
  Neon outage that outlasts the PostgreSQL retry window, or a BigQuery schema
  rejection. The store whose subscription dead-lettered is now missing that
  event; the other store has it.

Independently of live delivery, **BigQuery is currently in a degraded /
transitional mode**: its backfill is disabled, so BigQuery holds only the events
delivered since its table was created and has **not** been backfilled with the
older history that PostgreSQL carries. Until BigQuery backfill is re-enabled,
BigQuery is expected to lag PostgreSQL by that historical gap.

## Blast radius

**Bounded.** Because BigQuery is archival and no product read path reads it, a
diverged or lagging BigQuery does not produce wrong answers to users today. The
risk this doc addresses is therefore **"the divergence is undocumented and
unmonitored,"** not "the data users see is wrong." This framing changes the day
a read path starts trusting BigQuery — at that point promote monitoring
(below) and revisit this contract.

## Detection

**Today: none.** The two DLQ alert policies
(`terraform/modules/desirelines/alerts.tf`) fire only on
`num_undelivered_messages` for their own subscription. Nothing cross-checks
"PostgreSQL has activity X but BigQuery does not." An on-call responding to a
DLQ alert should know the **other** store is now ahead — the DLQ runbooks
cross-link here for that reason.

**A cheap divergence detector is deliberately deferred.** A scheduled row-count
or `id` set-difference between `desirelines.activities` (PostgreSQL) and the
BigQuery `activities` table would, run today, simply re-report the **known**
un-backfilled historical gap rather than any live-delivery drift — so it would
be noise, not signal, and it would wake the (compute-metered) database on a
schedule for no actionable result. **Trigger to build it:** once BigQuery
backfill is re-enabled and BigQuery has been caught up to PostgreSQL, add a
periodic count/`id`-diff compare that alerts when the delta exceeds a small
threshold. Before that, the gap is expected and this document is the record of
why.

## Escalation (explicitly not built)

A **true reconciler** — one that re-drives only the specific diverged ids from
the source of truth rather than re-running a blanket backfill — is a larger
build and is **not** created speculatively. Gate it on evidence from the
detector above that live-delivery divergence actually happens at a rate worth
automating. Until then, the blanket backfill job is the reconciliation path.

## Related

- [Pub/Sub Subscription Design](pubsub-subscription-design.md) — the fan-out and
  DLQ mechanics.
- DLQ runbooks: [`dlq-postgres-writer.md`](../runbooks/dlq-postgres-writer.md),
  [`dlq-bq-inserter.md`](../runbooks/dlq-bq-inserter.md).
