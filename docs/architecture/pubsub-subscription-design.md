# Pub/Sub Subscription Architecture

## Overview

The system uses Pub/Sub push subscriptions to deliver events from the dispatcher to downstream Cloud Run services. Two topics separate activity events from deauthorization events, each with independent scaling and retry behavior.

## Architecture

```
Strava Webhook → Dispatcher (Cloud Run)
                    │
                    ├── Activity events (create/update/delete)
                    │   → [enrich via Strava API]
                    │   → activity_events topic
                    │       ├── Push → bq-inserter (Cloud Run) → BigQuery
                    │       └── Push → postgres-writer (Cloud Run) → PostgreSQL
                    │
                    └── Deauth events (user disconnects app)
                        → [delete tokens from Firestore]
                        → deauth_events topic
                            └── Push → deletion-service (Cloud Run)
                                    ├── PostgreSQL (DELETE, CASCADE)
                                    ├── BigQuery (archive + DELETE)
                                    └── Firestore (tokens, profile, config, allowlist)
```

### Why two topics?

- **Clean separation** — `activity_events` stays activity-only; bq-inserter/postgres-writer don't receive events they can't process
- **Independent retry/SLA** — deauth events have a 48-hour compliance deadline ([Strava API Agreement Section 5.4](https://www.strava.com/legal/api)); activity events are best-effort
- **Independent scaling** — deauth events are rare; activity events are frequent

The dispatcher enriches activity CREATE events — and type-change UPDATE events — with full activity data from the Strava API before publishing. (A type change is the one UPDATE that needs a re-fetch: Strava's webhook carries only the broad `type`, not the granular `sport_type` the `sport` column stores.) Title/private-only UPDATEs and DELETEs are published without a re-fetch. Downstream consumers receive `EnrichedEvent` messages with activity data inline and do not call the Strava API.

## Event Delivery Pattern

Push subscriptions deliver PubSub messages to Cloud Run services as **CloudEvents** with:

- Headers: `ce-type`, `ce-id`, `ce-source`, `ce-time`
- Body: PubSub message envelope with base64-encoded data
- Query parameter: `__GCP_CloudEventsMode=CUSTOM_PUBSUB_{topic_id}`

Services parse CloudEvents via `stravapipe.cloudrun.pubsub.parse_pubsub_cloudevent()`.

## Terraform Implementation

### Subscription Resources

We create Pub/Sub push subscriptions directly (not via Eventarc `event_trigger` blocks):

```hcl
resource "google_pubsub_subscription" "bq_inserter" {
  name  = "desirelines-bq-inserter-${var.environment}"
  topic = google_pubsub_topic.activity_events.name

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.bq_inserter.uri}?__GCP_CloudEventsMode=..."
    oidc_token {
      service_account_email = google_service_account.bq_inserter.email
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}
```

All subscriptions follow the same pattern: OIDC authentication, dead-letter after 5 attempts, exponential backoff, 600s ack deadline.

### Why Manual Subscriptions (Not Eventarc)?

Manual subscriptions provide:

- Stable, predictable naming
- DLQ configured from the start (not added post-creation)
- Full lifecycle management by Terraform
- Clear configuration in one place

### Subscriptions

| Subscription | Topic | Target | Purpose |
|-------------|-------|--------|---------|
| `bq-inserter` | `activity_events` | bq-inserter service | Sync activities to BigQuery |
| `postgres-writer` | `activity_events` | postgres-writer service | Sync activities to PostgreSQL |
| `deletion-service` | `deauth_events` | deletion-service | Delete user data on deauth |
| `*-dlq` | `dead_letter` | Pull (manual inspection) | Debug failed messages |

## Local Development

The PubSub emulator doesn't send CloudEvent headers. A **CloudEvent Adapter** bridges the gap:

```
PubSub Emulator → CloudEvent Adapter → [adds ce-* headers] → Services
```

See `local-dev/containers/cloudevent-adapter/cloudevent_adapter.py`.

## Related Files

- `terraform/modules/desirelines/pubsub_subscriptions.tf` - Subscription definitions
- `terraform/modules/desirelines/cloud_run.tf` - Service definitions
- `terraform/modules/desirelines/main.tf` - Topic definitions
- `packages/stravapipe/src/stravapipe/cloudrun/pubsub.py` - CloudEvent parsing
