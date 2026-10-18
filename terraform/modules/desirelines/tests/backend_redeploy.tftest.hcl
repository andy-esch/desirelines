# Use the real provider schemas with mocked operations. These tests cannot prove
# Cloud Run creates a healthy revision; the deployment repo's owner-run dev check
# must verify new revisions, stable service identities and deletion protection.
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
  image_digests = {
    dispatcher = "sha256:1111111111111111111111111111111111111111111111111111111111111111"
    apigateway = "sha256:2222222222222222222222222222222222222222222222222222222222222222"
    stravapipe = "sha256:3333333333333333333333333333333333333333333333333333333333333333"
  }
}

run "default_adds_no_rollout_label" {
  command = plan

  assert {
    condition = alltrue([
      length(coalesce(google_cloud_run_v2_service.dispatcher.template[0].labels, {})) == 0,
      length(coalesce(google_cloud_run_v2_service.api_gateway.template[0].labels, {})) == 0,
      length(coalesce(google_cloud_run_v2_service.postgres_writer.template[0].labels, {})) == 0,
    ])
    error_message = "Existing callers must not gain a revision label without opting in."
  }

  assert {
    condition = alltrue([
      google_cloud_run_v2_service.dispatcher.deletion_protection,
      google_cloud_run_v2_service.api_gateway.deletion_protection,
      google_cloud_run_v2_service.postgres_writer.deletion_protection,
    ])
    error_message = "All three restart targets must retain deletion protection."
  }
}

run "dev_rollout_uses_only_three_revision_templates" {
  command = plan
  variables {
    backend_redeploy_token = "gh-39030336802-1"
  }

  assert {
    condition = alltrue([
      google_cloud_run_v2_service.dispatcher.template[0].labels["desirelines-redeploy"] == var.backend_redeploy_token,
      google_cloud_run_v2_service.api_gateway.template[0].labels["desirelines-redeploy"] == var.backend_redeploy_token,
      google_cloud_run_v2_service.postgres_writer.template[0].labels["desirelines-redeploy"] == var.backend_redeploy_token,
    ])
    error_message = "The token must reach each intended service's revision template."
  }

  assert {
    condition = alltrue([
      !contains(keys(google_cloud_run_v2_service.dispatcher.labels), "desirelines-redeploy"),
      !contains(keys(google_cloud_run_v2_service.api_gateway.labels), "desirelines-redeploy"),
      !contains(keys(google_cloud_run_v2_service.postgres_writer.labels), "desirelines-redeploy"),
      length(coalesce(google_cloud_run_v2_service.deletion_service.template[0].labels, {})) == 0,
      length(coalesce(google_cloud_run_v2_job.backfill.template[0].labels, {})) == 0,
      !contains(keys(google_bigquery_table.activities_live.labels), "desirelines-redeploy"),
    ])
    error_message = "The rollout marker must not become a service-wide label or affect other services, jobs or data resources."
  }

  assert {
    condition = alltrue([
      endswith(google_cloud_run_v2_service.dispatcher.template[0].containers[0].image, "@${var.image_digests.dispatcher}"),
      endswith(google_cloud_run_v2_service.api_gateway.template[0].containers[0].image, "@${var.image_digests.apigateway}"),
      endswith(google_cloud_run_v2_service.postgres_writer.template[0].containers[0].image, "@${var.image_digests.stravapipe}"),
      google_cloud_run_v2_service.dispatcher.deletion_protection,
      google_cloud_run_v2_service.api_gateway.deletion_protection,
      google_cloud_run_v2_service.postgres_writer.deletion_protection,
    ])
    error_message = "Rolling fresh revisions must preserve selected image digests and deletion protection."
  }
}

run "prod_rollout_keeps_protection" {
  command = plan
  variables {
    environment            = "prod"
    backend_redeploy_token = "gh-39030336802-2"
  }

  assert {
    condition = alltrue([
      google_cloud_run_v2_service.dispatcher.template[0].labels["desirelines-redeploy"] == var.backend_redeploy_token,
      google_cloud_run_v2_service.api_gateway.template[0].labels["desirelines-redeploy"] == var.backend_redeploy_token,
      google_cloud_run_v2_service.postgres_writer.template[0].labels["desirelines-redeploy"] == var.backend_redeploy_token,
      google_cloud_run_v2_service.dispatcher.deletion_protection,
      google_cloud_run_v2_service.api_gateway.deletion_protection,
      google_cloud_run_v2_service.postgres_writer.deletion_protection,
    ])
    error_message = "Production uses the same protected in-place rollout contract as dev."
  }
}

run "accept_maximum_label_length" {
  command = plan
  variables {
    backend_redeploy_token = "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz1"
  }

  assert {
    condition     = google_cloud_run_v2_service.dispatcher.template[0].labels["desirelines-redeploy"] == var.backend_redeploy_token
    error_message = "A valid 63-character label value must be accepted."
  }
}

run "reject_uppercase_token" {
  command = plan
  variables {
    backend_redeploy_token = "GH-123"
  }
  expect_failures = [var.backend_redeploy_token]
}

run "reject_multiline_token" {
  command = plan
  variables {
    backend_redeploy_token = "gh-123\nextra"
  }
  expect_failures = [var.backend_redeploy_token]
}

run "reject_overlong_token" {
  command = plan
  variables {
    backend_redeploy_token = "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz12"
  }
  expect_failures = [var.backend_redeploy_token]
}
