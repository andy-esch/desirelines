# 1. Durable Pub/Sub pipeline: DLQ contract, idempotency, bounded redelivery

**Severity:** High — this is the difference between "works most days" and
"ships."

## What's there today

- `bq_inserter_app.py:91`, `postgres_writer_app.py`, and
  `deletion_service_app.py` all return HTTP 5xx on failure, relying on
  Pub/Sub's at-least-once semantics to retry.
- BigQuery writes are idempotent via `MERGE` from a staging table
  (`adapters/gcp/_bigquery.py:82`).
- Postgres writes check duplicates inside `uow.activities.insert()` and skip
  if already present.
- The deletion service docstring says "On partial failure, returns 500 to
  trigger Pub/Sub retry via dead-letter redelivery," but the DLQ is **only an
  infrastructure contract** — nothing in code asserts it.

## Concrete gaps

1. **No max-attempts handling.** A persistently bad message (e.g. malformed
   `raw_activity` after a Strava API change) will retry until subscription
   expiry. The 422 path in `webhook_handler.py:133` and `webhook_handler.py:143`
   correctly uses 4xx so Pub/Sub stops, but the catch-all in
   `webhook_handler.py:194` returns 500 for *any* unexpected error —
   including permanent ones like a Pydantic validation explosion on a new
   field.
2. **No explicit idempotency token.** BQ's MERGE makes activity writes
   order-independent on `id`, but the **deletion service** is not obviously
   idempotent: if the message redelivers after a partial PG+BQ delete,
   behavior depends on whether each adapter is null-safe on missing rows.
   Worth verifying and asserting.
3. **No correlation between Pub/Sub `messageId` and downstream operations.**
   Logs include `correlation_id` (good) but not
   `pubsub_message_id`/`delivery_attempt`, making it hard to trace a
   redelivered poison-pill across attempts.

## Recommendations

- **Distinguish permanent vs transient errors** in
  `webhook_handler.py:194`. Catch `ValidationError`, `ValueError` (Pydantic),
  and known schema-drift exceptions and return 4xx (e.g. 422). Reserve 5xx
  strictly for transient infra errors (BQ 503, PG `OperationalError`,
  network timeouts). Pub/Sub's redelivery policy is documented to retry on
  5xx and ack on 4xx.
- **Configure a DLQ topic in IaC** with `maxDeliveryAttempts` (5–10 is
  typical) on each subscription, and add a tiny consumer or alert on the
  DLQ topic. This is a Terraform/Pulumi change, not Python — but the
  Python services should log `delivery_attempt` (available on the Pub/Sub
  message at `attributes.googclient_deliveryattempt`) so you can
  distinguish first delivery from retries.
- **Add a `pubsub_message_id` field to every log line** by extracting
  `context["id"]` in `parse_pubsub_cloudevent` and putting it on the
  contextvar alongside `correlation_id`. This lets you join all redelivery
  attempts of a poison pill in Cloud Logging.
- **Assert idempotency in tests.** Add a unit test for each handler that
  runs the same CloudEvent twice and verifies a single end-state.

## References

- Pub/Sub push subscription error handling:
  <https://cloud.google.com/pubsub/docs/push#receive_push>
- Pub/Sub error handling and DLQ:
  <https://cloud.google.com/pubsub/docs/handling-failures>
- Eventarc + Cloud Run idempotency guidance:
  <https://cloud.google.com/eventarc/docs/event-best-practices>
- Brandur's "Implementing Stripe-like idempotency keys in Postgres":
  <https://brandur.org/idempotency-keys>
