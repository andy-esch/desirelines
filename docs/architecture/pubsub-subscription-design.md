# Pub/Sub and Eventarc Architecture

## Current Architecture

```
Strava Webhook → Dispatcher (Cloud Run) → [enrich via Strava API] → PubSub Topic
                                                                         ↓
                                                         ┌───────────────┴───────────────┐
                                                         ↓                               ↓
                                                   Eventarc Trigger                Eventarc Trigger
                                                         ↓                               ↓
                                                   bq-inserter                    postgres-writer
                                                   (Cloud Run)                     (Cloud Run)
                                                         ↓                               ↓
                                                     BigQuery                       PostgreSQL
                                                   (analytics)                    (primary backend)
```

The dispatcher enriches CREATE events with full activity data from the Strava API before publishing. Downstream consumers receive `EnrichedEvent` messages with activity data inline and do not call the Strava API.

## Event Delivery Pattern

Eventarc delivers PubSub messages to Cloud Run/Functions as **CloudEvents** with:
- Headers: `ce-type`, `ce-id`, `ce-source`, `ce-time`
- Body: PubSub message envelope with base64-encoded data

Services parse CloudEvents via `stravapipe.cloudrun.pubsub.parse_pubsub_cloudevent()`.

## Terraform Implementation

### Subscription Resources

We create Pub/Sub subscriptions manually (not via `event_trigger` blocks):

```hcl
resource "google_pubsub_subscription" "bq_inserter" {
  name  = "desirelines-bq-inserter-${var.environment}"
  topic = google_pubsub_topic.activity_events.name

  push_config {
    push_endpoint = google_cloud_run_v2_service.bq_inserter.uri
    oidc_token {
      service_account_email = var.service_account_email
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

### Why Manual Subscriptions?

Manual subscriptions provide:
- Stable, predictable naming
- DLQ configured from the start
- Full lifecycle management by Terraform
- Clear configuration in one place

## Local Development

The PubSub emulator doesn't send CloudEvent headers. A **CloudEvent Adapter** bridges the gap:

```
PubSub Emulator → CloudEvent Adapter → [adds ce-* headers] → Services
```

See `local-dev/containers/cloudevent-adapter/cloudevent_adapter.py`.

## Related Files

- `terraform/modules/desirelines/eventarc.tf` - Subscription definitions
- `terraform/modules/desirelines/cloud_run.tf` - Service definitions
- `packages/stravapipe/src/stravapipe/cloudrun/pubsub.py` - CloudEvent parsing
