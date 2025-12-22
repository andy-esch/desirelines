# ==============================================================================
# Eventarc Triggers for Pub/Sub → Cloud Run
# ==============================================================================
# These triggers replace the event_trigger blocks in google_cloudfunctions2_function
# resources. Eventarc delivers CloudEvents as HTTP POST requests to Cloud Run services.
#
# Note: Cloud Functions v2 with event_trigger automatically creates Eventarc triggers
# under the hood, but for Cloud Run services we need to create them explicitly.

# ------------------------------------------------------------------------------
# BQ Inserter Trigger
# ------------------------------------------------------------------------------
# Triggers the BQ Inserter Cloud Run service when messages are published to the
# activity events topic

resource "google_eventarc_trigger" "bq_inserter_pubsub" {
  name     = "${var.project_name}-bq-inserter-trigger"
  location = var.gcp_region

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.pubsub.topic.v1.messagePublished"
  }

  transport {
    pubsub {
      topic = google_pubsub_topic.activity_events.id
    }
  }

  destination {
    cloud_run_service {
      service = google_cloud_run_v2_service.bq_inserter.name
      region  = var.gcp_region
    }
  }

  service_account = google_service_account.bq_inserter.email

  labels = local.common_labels

  depends_on = [
    google_cloud_run_v2_service.bq_inserter
  ]
}

# ------------------------------------------------------------------------------
# PostgreSQL Writer Trigger
# ------------------------------------------------------------------------------
# Triggers the PostgreSQL Writer Cloud Run service when messages are published
# to the activity events topic

resource "google_eventarc_trigger" "postgres_writer_pubsub" {
  name     = "${var.project_name}-postgres-writer-trigger"
  location = var.gcp_region

  matching_criteria {
    attribute = "type"
    value     = "google.cloud.pubsub.topic.v1.messagePublished"
  }

  transport {
    pubsub {
      topic = google_pubsub_topic.activity_events.id
    }
  }

  destination {
    cloud_run_service {
      service = google_cloud_run_v2_service.postgres_writer.name
      region  = var.gcp_region
    }
  }

  service_account = google_service_account.postgres_writer.email

  labels = local.common_labels

  depends_on = [
    google_cloud_run_v2_service.postgres_writer
  ]
}
