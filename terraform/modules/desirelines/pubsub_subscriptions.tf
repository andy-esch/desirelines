# ==============================================================================
# Pub/Sub Push Subscriptions for Cloud Run Services
# ==============================================================================
# These subscriptions replace Eventarc triggers, providing:
# - Stable, predictable subscription names across deployments
# - DLQ configuration from the start (not added post-creation)
# - Full Terraform lifecycle management
# - Explicit retry and ack deadline configuration
#
# Uses __GCP_CloudEventsMode query parameter to deliver messages in CloudEvents
# format, maintaining compatibility with existing service code.
# ==============================================================================

# ------------------------------------------------------------------------------
# BQ Inserter Push Subscription
# ------------------------------------------------------------------------------
resource "google_pubsub_subscription" "bq_inserter" {
  name  = "${var.project_name}-bq-inserter-${var.environment}"
  topic = google_pubsub_topic.activity_events.name

  # Push to Cloud Run service with CloudEvents format
  push_config {
    push_endpoint = "${google_cloud_run_v2_service.bq_inserter.uri}?__GCP_CloudEventsMode=CUSTOM_PUBSUB_${google_pubsub_topic.activity_events.id}"

    oidc_token {
      service_account_email = google_service_account.bq_inserter.email
      audience              = google_cloud_run_v2_service.bq_inserter.uri
    }

    attributes = {
      x-goog-version = "v1"
    }
  }

  # Dead letter policy - failed messages go to DLQ after max attempts
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }

  # Retry policy with exponential backoff
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  # Long ack deadline for potentially slow BigQuery operations
  ack_deadline_seconds = 600

  # Retain messages for 7 days (matches topic retention)
  message_retention_duration = "604800s"

  # Note: exactly-once delivery is not supported with push subscriptions
  # Data consistency is achieved through idempotent handlers in the service

  labels = merge(local.common_labels, {
    service = "bq-inserter"
    type    = "push-subscription"
  })

  depends_on = [
    google_cloud_run_v2_service.bq_inserter,
    google_project_service.required_apis
  ]
}

# ------------------------------------------------------------------------------
# PostgreSQL Writer Push Subscription
# ------------------------------------------------------------------------------
resource "google_pubsub_subscription" "postgres_writer" {
  name  = "${var.project_name}-postgres-writer-${var.environment}"
  topic = google_pubsub_topic.activity_events.name

  # Push to Cloud Run service with CloudEvents format
  push_config {
    push_endpoint = "${google_cloud_run_v2_service.postgres_writer.uri}?__GCP_CloudEventsMode=CUSTOM_PUBSUB_${google_pubsub_topic.activity_events.id}"

    oidc_token {
      service_account_email = google_service_account.postgres_writer.email
      audience              = google_cloud_run_v2_service.postgres_writer.uri
    }

    attributes = {
      x-goog-version = "v1"
    }
  }

  # Dead letter policy - failed messages go to DLQ after max attempts
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }

  # Retry policy with exponential backoff
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  # Ack deadline for PostgreSQL operations
  ack_deadline_seconds = 600

  # Retain messages for 7 days (matches topic retention)
  message_retention_duration = "604800s"

  # Note: exactly-once delivery is not supported with push subscriptions
  # Data consistency is achieved through idempotent handlers in the service

  labels = merge(local.common_labels, {
    service = "postgres-writer"
    type    = "push-subscription"
  })

  depends_on = [
    google_cloud_run_v2_service.postgres_writer,
    google_project_service.required_apis
  ]
}

# ------------------------------------------------------------------------------
# Deletion Service Push Subscription (deauth_events topic)
# ------------------------------------------------------------------------------
resource "google_pubsub_subscription" "deletion_service" {
  name  = "${var.project_name}-deletion-service-${var.environment}"
  topic = google_pubsub_topic.deauth_events.name

  # Push to Cloud Run service with CloudEvents format
  push_config {
    push_endpoint = "${google_cloud_run_v2_service.deletion_service.uri}?__GCP_CloudEventsMode=CUSTOM_PUBSUB_${google_pubsub_topic.deauth_events.id}"

    oidc_token {
      service_account_email = google_service_account.deletion_service.email
      audience              = google_cloud_run_v2_service.deletion_service.uri
    }

    attributes = {
      x-goog-version = "v1"
    }
  }

  # Dead letter policy - failed messages go to DLQ after max attempts
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }

  # Retry policy with exponential backoff
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  # Long ack deadline for multi-store deletion operations
  ack_deadline_seconds = 600

  # Retain messages for 7 days (matches topic retention)
  message_retention_duration = "604800s"

  labels = merge(local.common_labels, {
    service = "deletion-service"
    type    = "push-subscription"
  })

  depends_on = [
    google_cloud_run_v2_service.deletion_service,
    google_project_service.required_apis
  ]
}

# ==============================================================================
# IAM: Allow Pub/Sub to invoke Cloud Run services
# ==============================================================================
# The push subscriptions use OIDC tokens signed by the service accounts.
# The service accounts need permission to invoke their respective Cloud Run services.

# Note: These IAM bindings already exist in cloud_run.tf:
# - google_cloud_run_v2_service_iam_member.bq_inserter_eventarc_invoker
# - google_cloud_run_v2_service_iam_member.postgres_writer_eventarc_invoker
# They grant run.invoker to the service accounts, which is what we need.

# ==============================================================================
# Dead Letter Queue Monitoring Subscriptions
# ==============================================================================
# These pull subscriptions allow monitoring and debugging of failed messages.
# Messages that fail delivery after max_delivery_attempts end up in the DLQ topic.

resource "google_pubsub_subscription" "bq_inserter_dlq" {
  name  = "${var.project_name}-bq-inserter-dlq-${var.environment}"
  topic = google_pubsub_topic.dead_letter.name

  # Long retention for debugging failed messages
  message_retention_duration = "1209600s" # 14 days
  ack_deadline_seconds       = 600

  # No push config - this is a pull subscription for manual inspection

  labels = merge(local.common_labels, {
    purpose = "dead-letter-queue"
    service = "bq-inserter"
    type    = "dlq-monitoring"
  })

  depends_on = [google_project_service.required_apis]
}

resource "google_pubsub_subscription" "postgres_writer_dlq" {
  name  = "${var.project_name}-postgres-writer-dlq-${var.environment}"
  topic = google_pubsub_topic.dead_letter.name

  # Long retention for debugging failed messages
  message_retention_duration = "1209600s" # 14 days
  ack_deadline_seconds       = 600

  # No push config - this is a pull subscription for manual inspection

  labels = merge(local.common_labels, {
    purpose = "dead-letter-queue"
    service = "postgres-writer"
    type    = "dlq-monitoring"
  })

  depends_on = [google_project_service.required_apis]
}

resource "google_pubsub_subscription" "deletion_service_dlq" {
  name  = "${var.project_name}-deletion-service-dlq-${var.environment}"
  topic = google_pubsub_topic.dead_letter.name

  # Long retention for debugging failed deletions
  message_retention_duration = "1209600s" # 14 days
  ack_deadline_seconds       = 600

  labels = merge(local.common_labels, {
    purpose = "dead-letter-queue"
    service = "deletion-service"
    type    = "dlq-monitoring"
  })

  depends_on = [google_project_service.required_apis]
}
