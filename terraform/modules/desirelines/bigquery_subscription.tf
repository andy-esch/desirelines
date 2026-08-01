# ==============================================================================
# BigQuery-subscription CDC prototype (ADDITIVE — off by default)
# ==============================================================================
#
# An isolated prototype of the target BigQuery write path: Pub/Sub writes
# activity rows straight to BigQuery in CDC mode, with no writer service, no
# staging table, and no MERGE. See docs/architecture/bigquery-write-architecture.md.
#
# Everything here is additive: the existing activity_events topic, the
# postgres-writer / bq-inserter subscriptions, and the activities /
# activities_staging / deleted_activities tables are untouched. The only
# producer is the dispatcher's best-effort dual-publish, which is off unless
# app_config.dispatcher_activity_row_publish_enabled says otherwise and which
# cannot fail a webhook. A misbehaving prototype can only affect
# activities_live, which nothing reads.
#
# ---- Mode: use_table_schema + JSON (prototype) --------------------------------
# The subscription maps JSON message fields to the destination table's schema
# (use_table_schema), so there is NO Pub/Sub topic schema and NO protobuf here.
# CDC is implicit: because activities_live has a primary key, a message whose
# body carries `_CHANGE_TYPE = "UPSERT" | "DELETE"` (and optional
# `_CHANGE_SEQUENCE_NUMBER` for ordering) is applied as an upsert/delete rather
# than a plain append.
#
# ---- The 1-to-1 seam to protobuf (future) -------------------------------------
# Moving to publish-time-typed protobuf is a small, local change and does NOT
# touch the table, the CDC semantics, the DLQ, or the IAM below:
#   1. add a `google_pubsub_schema` (PROTOCOL_BUFFER) built from the
#      `bq_activities` proto + the two CDC fields, and set `schema_settings` on
#      `activity_rows` below;
#   2. flip `use_table_schema` -> `use_topic_schema` in the bigquery_config;
#   3. the producer publishes proto bytes instead of JSON.
# (proto <-> BQ schema mapping is fiddly, but that is deliberately out of scope
# for this spike.)
#
# ---- Smoke test (run after apply; needs a dev project) ------------------------
#   T="$(terraform output -raw activity_rows_topic)"      # or the literal name
#   # UPSERT a row (JSON must match the activities schema + carry _CHANGE_TYPE):
#   gcloud pubsub topics publish "$T" --message='{"id":999000001,"user_id":"1",
#     "name":"smoke","type":"Run","sport_type":"Run","start_date":"2026-01-01T00:00:00Z",
#     "start_date_local":"2026-01-01T00:00:00Z","distance":1000.0,"moving_time":600,
#     "elapsed_time":600,"_CHANGE_TYPE":"UPSERT","_CHANGE_SEQUENCE_NUMBER":"01/00000001"}'
#   # ...confirm one row, then DELETE it, then publish two out-of-order
#   # _CHANGE_SEQUENCE_NUMBER values and confirm the newest wins:
#   bq query --use_legacy_sql=false 'SELECT id,name FROM `<dataset>.activities_live` WHERE id=999000001'
# Record: the exact _CHANGE_TYPE/_CHANGE_SEQUENCE_NUMBER placement + format, and
# that photos.urls (JSON) accepts null/omitted (never ""), for the producer task.
# ==============================================================================

# ---- Topic that carries activity ROW messages (schemaless for the JSON spike) -
resource "google_pubsub_topic" "activity_rows" {
  name   = "${var.project_name}-activity-rows-${var.environment}"
  labels = local.common_labels

  message_retention_duration = "604800s" # 7 days

  # NOTE (proto seam): add `schema_settings { schema = ..., encoding = "BINARY" }`
  # here when moving to use_topic_schema + protobuf.

  depends_on = [google_project_service.required_apis]
}

# ---- Dedicated dead-letter topic + inspection subscription --------------------
# Isolated from the shared prod dead_letter topic so prototype failures stay
# self-contained. Schema-incompatible / malformed rows land here.
resource "google_pubsub_topic" "activity_rows_dead_letter" {
  name   = "${var.project_name}-activity-rows-dlq-${var.environment}"
  labels = local.common_labels

  depends_on = [google_project_service.required_apis]
}

resource "google_pubsub_subscription" "activity_rows_dlq_monitoring" {
  name  = "${var.project_name}-activity-rows-dlq-monitoring-${var.environment}"
  topic = google_pubsub_topic.activity_rows_dead_letter.name

  labels                     = local.common_labels
  message_retention_duration = "1209600s" # 14 days — longer, for debugging
  ack_deadline_seconds       = 600
}

# ---- BigQuery destination table (CDC requires a primary key) ------------------
resource "google_bigquery_table" "activities_live" {
  dataset_id          = google_bigquery_dataset.activities_dataset.dataset_id
  table_id            = "activities_live"
  friendly_name       = "Strava Activities (live, CDC)"
  description         = "Current activity state maintained by a Pub/Sub CDC subscription (UPSERT/DELETE). Prototype; nothing reads it yet."
  deletion_protection = false # prototype table — iterate freely

  labels = local.common_labels

  # Same schema as the production activities table.
  schema = jsonencode(jsondecode(file("${path.module}/../../../schemas/bigquery/activities_full.json")).schema)

  # CDC upserts/deletes key on this primary key (non-enforced in BigQuery).
  table_constraints {
    primary_key {
      columns = ["id"]
    }
  }

  # Cluster on the CDC key for upsert/merge efficiency.
  clustering = ["id"]
}

# ---- The CDC BigQuery subscription (no subscriber code) -----------------------
resource "google_pubsub_subscription" "activities_live_writer" {
  name  = "${var.project_name}-activities-live-writer-${var.environment}"
  topic = google_pubsub_topic.activity_rows.name

  labels = merge(local.common_labels, {
    service = "activities-live"
    type    = "bigquery-subscription"
  })

  bigquery_config {
    table = "${var.gcp_project_id}.${google_bigquery_dataset.activities_dataset.dataset_id}.${google_bigquery_table.activities_live.table_id}"

    # JSON messages mapped to the table schema (prototype). CDC is implicit via
    # the table primary key + the message's _CHANGE_TYPE field.
    use_table_schema = true

    # Tolerate Strava fields that aren't columns in the BQ schema. The CDC
    # pseudo-fields (_CHANGE_TYPE / _CHANGE_SEQUENCE_NUMBER) are reserved and
    # consumed by CDC, not treated as unknown columns.
    drop_unknown_fields = true

    # Leaving service_account_email unset => writes as the Pub/Sub service agent,
    # which is granted BigQuery Data Editor on the table below.
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.activity_rows_dead_letter.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  message_retention_duration = "604800s" # 7 days

  depends_on = [google_project_service.required_apis]
}

# ---- IAM (least privilege) ----------------------------------------------------
# The dispatcher publishes activity rows here when its dual-publish flag is on.
# Granted unconditionally: the grant alone changes no behavior (the flag gates
# whether anything is published), and having it in place keeps flipping the flag
# a config-only change.
resource "google_pubsub_topic_iam_member" "dispatcher_activity_rows_publisher" {
  topic  = google_pubsub_topic.activity_rows.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.dispatcher.email}"
}

# The Pub/Sub service agent writes the rows into BigQuery.
resource "google_bigquery_table_iam_member" "activities_live_pubsub_writer" {
  dataset_id = google_bigquery_dataset.activities_dataset.dataset_id
  table_id   = google_bigquery_table.activities_live.table_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:service-${var.gcp_project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

# Dead-letter forwarding: the Pub/Sub service agent must publish to the DLQ topic
# and be a subscriber on the source subscription (mirrors the existing DLQ IAM).
resource "google_pubsub_topic_iam_member" "activity_rows_dlq_publisher" {
  topic  = google_pubsub_topic.activity_rows_dead_letter.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${var.gcp_project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_subscription_iam_member" "activities_live_writer_dlq_subscriber" {
  subscription = google_pubsub_subscription.activities_live_writer.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:service-${var.gcp_project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}
