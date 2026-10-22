# Schema/topic/table contracts for bigquery_subscription.tf.
# Live proof: docs/runbooks/activity-row-schema-changes.md#verify-delivery-and-rollback
mock_provider "google" {}
mock_provider "google-beta" {}
mock_provider "external" {
  mock_data "external" {
    defaults = {
      result = { exists = "true" }
    }
  }
}

variables {
  environment                                           = "dev"
  gcp_project_id                                        = "desirelines-test"
  gcp_project_number                                    = "123456789012"
  deployment_version                                    = "0123456789abcdef0123456789abcdef01234567"
  external_artifact_registry                            = "us-central1-docker.pkg.dev/desirelines-test/services"
  infisical_project_id                                  = "test-project"
  dispatcher_webhook_callback_capability_secret_version = "1"
  app_config = {
    log_level                        = "INFO"
    dispatcher_activity_row_encoding = "proto"
  }
  image_digests = {
    dispatcher = "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    apigateway = "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    stravapipe = "sha256:3333333333333333333333333333333333333333333333333333333333333333"
  }
}

run "dev_preserves_deployed_schema" {
  command = plan

  assert {
    condition = (
      google_pubsub_schema.activity_rows.name == "desirelines-activity-rows-dev-693d93a6" &&
      google_pubsub_schema.activity_rows.type == "PROTOCOL_BUFFER" &&
      google_pubsub_schema.activity_rows.definition == file("../../../schemas/proto/desirelines/bigquery/cdc/v1/bq_activity_rows.proto") &&
      google_pubsub_schema.activity_rows.deletion_policy == "PREVENT"
    )
    error_message = "Adoption must preserve the deployed schema name and definition while protecting its stored lifecycle."
  }

  assert {
    condition = (
      google_bigquery_table.activities_live.dataset_id == "desirelines" &&
      google_bigquery_table.activities_live.table_id == "activities_live" &&
      google_bigquery_table.activities_live.schema == jsonencode(jsondecode(file("../../../schemas/bigquery/activities_live.json")).schema) &&
      google_bigquery_table.activities_live.clustering == tolist(["id"]) &&
      google_bigquery_table.activities_live.table_constraints[0].primary_key[0].columns == tolist(["id"]) &&
      !google_bigquery_table.activities_live.deletion_protection
    )
    error_message = "Dev must preserve the existing table address, source schema, CDC key and clustering without changing its stored deletion policy."
  }

  assert {
    condition = (
      google_pubsub_topic.activity_rows.schema_settings[0].encoding == "BINARY" &&
      coalesce(google_pubsub_topic.activity_rows.schema_settings[0].first_revision_id, "unbounded") == "unbounded" &&
      coalesce(google_pubsub_topic.activity_rows.schema_settings[0].last_revision_id, "unbounded") == "unbounded"
    )
    error_message = "Binary producers must keep an open schema revision range during rolling deployments."
  }
}

run "prod_preserves_deployed_schema" {
  command = plan
  variables {
    environment = "prod"
  }

  assert {
    condition = (
      google_pubsub_schema.activity_rows.name == "desirelines-activity-rows-prod-693d93a6" &&
      google_pubsub_schema.activity_rows.deletion_policy == "PREVENT"
    )
    error_message = "Production must preserve its deployed schema identity and prevent deletion."
  }

  assert {
    condition = (
      google_bigquery_table.activities_live.dataset_id == "desirelines" &&
      google_bigquery_table.activities_live.table_id == "activities_live" &&
      google_bigquery_table.activities_live.deletion_protection &&
      google_bigquery_table.activities_live.clustering == tolist(["id"]) &&
      google_bigquery_table.activities_live.table_constraints[0].primary_key[0].columns == tolist(["id"])
    )
    error_message = "Production must preserve table identity, CDC key, clustering and stored deletion protection."
  }
}
