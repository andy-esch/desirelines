# ==============================================================================
# BigQuery ingestion via Pub/Sub subscription (CDC)
# ==============================================================================
#
# The BigQuery write path: Pub/Sub writes activity rows straight to BigQuery in
# CDC mode, with no writer service, no staging table, and no MERGE. See
# docs/architecture/bigquery-write-architecture.md.
#
# The only producer is the dispatcher's best-effort publish, gated on
# app_config.dispatcher_activity_row_publish_enabled — which doubles as the kill
# switch for this path — and it cannot fail a webhook. A failure here can only
# affect activities_live; the user-facing read path is PostgreSQL, fed
# independently via postgres-writer.
#
# The publish-failure ALERT has its own gate, var.enable_activity_row_publish_alert.
# Keep them separate: the alert binds to a metric descriptor that only exists in
# a project once a row has been published there, so an environment can publish
# without being able to carry the alert.
#
# ---- Mode: selected by app_config.dispatcher_activity_row_encoding ------------
# One value drives three things that must agree: the dispatcher's
# ACTIVITY_ROW_ENCODING, whether this topic carries a protobuf schema, and
# whether the subscription maps by topic or table schema.
#
#   "json"  — schemaless topic; the subscription matches JSON field names
#             against the destination table (use_table_schema). Malformed rows
#             are accepted at publish and rejected later by BigQuery, so they
#             surface as dead letters.
#   "proto" — topic bound to the generated bq_activity_rows schema; the
#             subscription reads that (use_topic_schema). Pub/Sub validates at
#             publish time, so a bad row fails the publish call instead.
#
# CDC is implicit either way: because activities_live has a primary key, a
# message carrying `_CHANGE_TYPE = "UPSERT" | "DELETE"` (with
# `_CHANGE_SEQUENCE_NUMBER` for ordering) is applied as an upsert or delete
# rather than appended.
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

# ---- Topic schema, bound only when the producer speaks protobuf ---------------
# Created unconditionally so the schema exists to switch onto; binding it to the
# topic is what actually changes behavior, and that is gated below.
locals {
  activity_rows_proto_path = "${path.module}/../../../schemas/proto/desirelines/bigquery/cdc/v1/bq_activity_rows.proto"

  # A short digest of the definition, carried in the schema's name so a changed
  # definition produces a different resource.
  activity_rows_schema_suffix = substr(filesha256(local.activity_rows_proto_path), 0, 8)
}

# The name embeds a digest of the definition ON PURPOSE.
#
# Pub/Sub validates every schema revision against the previous one and rejects
# anything incompatible — in BOTH directions. Adding a required field is
# rejected; removing one is rejected too. This definition is generated from the
# BigQuery table schema, so an ordinary column change can produce an
# incompatible revision, and updating in place then fails the apply:
#
#   "Revision is incompatible with previous revision: …"
#
# Digesting the definition into the name sidesteps revisions entirely: a changed
# definition is a new schema at revision 1, with nothing to be compatible with.
# Terraform creates it, repoints the topic (verified to work in place, so the
# subscription is untouched), then deletes the old one.
#
# create_before_destroy is required, not decorative — the topic below cannot be
# repointed to a schema that has already been deleted.
resource "google_pubsub_schema" "activity_rows" {
  name       = "${var.project_name}-activity-rows-${var.environment}-${local.activity_rows_schema_suffix}"
  type       = "PROTOCOL_BUFFER"
  definition = file(local.activity_rows_proto_path)

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_pubsub_topic" "activity_rows" {
  name   = "${var.project_name}-activity-rows-${var.environment}"
  labels = local.common_labels

  message_retention_duration = "604800s" # 7 days

  # Binding the schema makes Pub/Sub validate at publish time, which is the
  # point of protobuf here: a row that does not fit the table is refused by the
  # publish call rather than accepted, delivered, and dead-lettered by BigQuery
  # minutes later.
  #
  # It also makes the topic reject JSON outright, so this and the dispatcher's
  # ACTIVITY_ROW_ENCODING must move together — hence both reading the same
  # variable. A Cloud Run revision does not roll instantly, so expect a brief
  # window where publishes fail; they surface as row_publish{result="error"}
  # and dead-letter nothing.
  dynamic "schema_settings" {
    for_each = var.app_config.dispatcher_activity_row_encoding == "proto" ? [1] : []
    content {
      schema   = google_pubsub_schema.activity_rows.id
      encoding = "BINARY"
    }
  }

  depends_on = [google_project_service.required_apis]
}

# ---- Dedicated dead-letter topic + inspection subscription --------------------
# Isolated from the shared dead_letter topic so a BigQuery rejection stays
# attributable to this path instead of cross-firing the other services' DLQ
# alerts. Schema-incompatible / malformed rows land here.
resource "google_pubsub_topic" "activity_rows_dead_letter" {
  name   = "${var.project_name}-activity-rows-dlq-${var.environment}"
  labels = local.common_labels

  # Retention matters more here than on any other topic. Clearing this DLQ is
  # how its CRITICAL alert is silenced, and the only record of *why* BigQuery
  # rejected a row is the CloudPubSubDeadLetterSourceDeliveryErrorMessage
  # attribute on the message itself. Without topic retention the inspection
  # subscription cannot seek backwards, so silencing the alert destroys the
  # diagnosis — which has already cost two investigations. Matches the
  # production dead_letter topic's 14 days.
  message_retention_duration = "1209600s" # 14 days

  depends_on = [google_project_service.required_apis]
}

resource "google_pubsub_subscription" "activity_rows_dlq_monitoring" {
  name  = "${var.project_name}-activity-rows-dlq-monitoring-${var.environment}"
  topic = google_pubsub_topic.activity_rows_dead_letter.name

  labels                     = local.common_labels
  message_retention_duration = "1209600s" # 14 days — longer, for debugging
  ack_deadline_seconds       = 600

  depends_on = [google_project_service.required_apis]
}

# ---- BigQuery destination table (CDC requires a primary key) ------------------
#
# The schema is the production activities schema with every top-level column
# except the primary key relaxed to NULLABLE. That is not cosmetic — it is what
# makes deletes possible:
#
# A CDC delete is addressed by primary key alone and carries no other column.
# But `use_table_schema` validates every message against the whole table schema
# before BigQuery ever sees the CDC semantics, so a REQUIRED column that a
# delete cannot supply rejects the message outright:
#
#   "JSON is missing required field: athlete, name, moving_time, …"
#
# and the delete dead-letters instead of removing the row. So a CDC table whose
# producer issues deletes cannot declare REQUIRED columns beyond its key.
#
# Under use_topic_schema there is a second, stricter reason. Pub/Sub compares
# the topic schema against the table schema statically, before any message
# exists, and proto2 labels every field `optional`. A REQUIRED column at ANY
# depth then fails the subscription update outright:
#
#   "Incompatible schema: field laps.start_date is required in table, but
#    nullable in topic"
#
# So no column can be REQUIRED — 106 nested ones included. The primary key is
# the exception, because BigQuery will not relax a key column on an existing
# table:
#
#   "Key column id cannot be modified or removed.
#    column's mode changed: REQUIRED -> NULLABLE"
#
# It stays REQUIRED here and the CDC proto labels it `required` to match, so the
# two schemas agree without this table being replaced. That pairing only binds
# when both are created together: Pub/Sub rejects a schema *revision* that adds
# or removes a required field, so changing it later means recreating the schema,
# the topic bound to it, and this table.
#
# The replace trigger below covers the table half of that. BigQuery silently
# declines some in-place schema edits — relaxing a key column among them — and a
# declined edit is not an apply error, so the drift would otherwise persist
# until the subscription failed to bind. Deploys apply on merge, so there is no
# reliable moment to drop the table by hand.
#
# REMOVE the trigger before this table carries data anything reads. Recreating
# on every schema change is only acceptable while the table is a rebuildable
# projection of the event stream.
#
# The relaxed schema is generated rather than transformed here: the nesting is
# three deep, HCL cannot recurse, and merge() would attach a null `fields` key
# to every scalar. See schemas/bigquery/generate_proto.py.
# Tracks the schema file so a change to it forces the table to be recreated
# rather than updated in place. BigQuery accepts most schema edits in place but
# refuses some — notably relaxing a key column — and a declined edit is not an
# apply error, so the drift would otherwise persist silently.
# Both this and the topic schema above are generated from activities_full.json,
# so a column change regenerates both and they move in the same apply: a new
# schema is created and bound, and the table is replaced.
resource "terraform_data" "activities_live_schema" {
  input = filesha256("${path.module}/../../../schemas/bigquery/activities_live.json")
}

# deletion_protection is deliberately false in every environment, including prod.
#
# This table was created as a throwaway prototype target and kept that setting
# when it became the live BigQuery table. It is defensible but no longer
# obviously right: it now holds the only live BigQuery activity data. Two things
# argue for leaving it off — nothing reads BigQuery, so losing the table costs
# analysis history rather than product behaviour; and a column retype requires
# recreating the table (BigQuery cannot change a column's type in place), which
# protection turns into a two-apply flag dance. See schemas/bigquery/README.md.
#
# Revisit if a read path ever trusts BigQuery, at which point the recreate story
# needs solving anyway.
resource "google_bigquery_table" "activities_live" {
  dataset_id          = google_bigquery_dataset.activities_dataset.dataset_id
  table_id            = "activities_live"
  friendly_name       = "Strava Activities (live, CDC)"
  description         = "Current activity state maintained by a Pub/Sub CDC subscription (UPSERT/DELETE). The live BigQuery activity table; archival, not a product read path."
  deletion_protection = false

  labels = local.common_labels

  schema = jsonencode(jsondecode(file("${path.module}/../../../schemas/bigquery/activities_live.json")).schema)

  # CDC upserts/deletes key on this primary key (non-enforced in BigQuery).
  table_constraints {
    primary_key {
      columns = ["id"]
    }
  }

  # Cluster on the CDC key for upsert/merge efficiency.
  clustering = ["id"]

  lifecycle {
    replace_triggered_by = [terraform_data.activities_live_schema]
  }
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

    # Which schema the subscription maps messages through, following the
    # producer's encoding. CDC is implicit either way, via the table primary key
    # plus the message's _CHANGE_TYPE field.
    #
    # use_topic_schema reads the protobuf schema bound to the topic above;
    # use_table_schema matches JSON field names against the destination table.
    # Exactly one may be set.
    use_topic_schema = var.app_config.dispatcher_activity_row_encoding == "proto"
    use_table_schema = var.app_config.dispatcher_activity_row_encoding != "proto"

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
# The dispatcher publishes activity rows here when its publish flag is on.
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
