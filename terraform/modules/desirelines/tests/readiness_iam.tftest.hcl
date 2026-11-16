# Mocked IAM contracts; live path enforcement must also pass after promotion.
mock_provider "google" {
  mock_resource "google_service_account" {
    defaults = {
      # IAM-member validation needs a resource name, not a random mock string.
      name = "projects/desirelines-test/serviceAccounts/mock-account@desirelines-test.iam.gserviceaccount.com"
    }
  }
}
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
  gcp_project_id                                        = "desirelines-dev-test"
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

run "dev_scheduler_cannot_invoke_data_routes" {
  command = apply

  assert {
    condition = (
      contains(keys(local.python_readiness_targets), "deletion-service") &&
      contains(keys(local.python_readiness_targets), "postgres-writer") &&
      alltrue([for key, grant in google_cloud_run_v2_service_iam_member.scheduler_python_invoker :
        grant.project == var.gcp_project_id &&
        grant.name == local.python_readiness_targets[key].name &&
        grant.role == "roles/run.invoker" &&
        grant.member == "serviceAccount:${google_service_account.scheduler.email}" &&
        length(grant.condition) == 1 &&
        grant.condition[0].expression == "request.path == \"/ready\""
      ]) && length(google_cloud_run_v2_service_iam_member.scheduler_python_invoker) == length(local.python_readiness_targets)
    )
    error_message = "Every Python readiness target must restrict this environment's scheduler to exactly /ready."
  }

  assert {
    condition = alltrue([for key, job in google_cloud_scheduler_job.python_readiness :
      job.http_target[0].http_method == "GET" &&
      job.http_target[0].uri == "${local.python_readiness_targets[key].uri}/ready" &&
      job.http_target[0].oidc_token[0].audience == local.python_readiness_targets[key].uri &&
      job.http_target[0].oidc_token[0].service_account_email == google_service_account.scheduler.email
    ])
    error_message = "Readiness must use GET /ready with the scheduler identity and service-root audience."
  }

  assert {
    condition = (
      google_cloud_run_v2_service_iam_member.deletion_service_invoker.member == "serviceAccount:${google_service_account.deletion_service.email}" &&
      google_cloud_run_v2_service_iam_member.postgres_writer_invoker.member == "serviceAccount:${google_service_account.postgres_writer.email}" &&
      google_pubsub_subscription.deletion_service.push_config[0].oidc_token[0].service_account_email == google_service_account.deletion_service.email &&
      google_pubsub_subscription.postgres_writer.push_config[0].oidc_token[0].service_account_email == google_service_account.postgres_writer.email &&
      google_service_account.scheduler.email != google_service_account.deletion_service.email &&
      google_service_account.scheduler.email != google_service_account.postgres_writer.email &&
      length(google_cloud_run_v2_service_iam_member.deletion_service_invoker.condition) == 0 &&
      length(google_cloud_run_v2_service_iam_member.postgres_writer_invoker.condition) == 0
    )
    error_message = "Pub/Sub must retain its separate runtime invokers, without a readiness path restriction."
  }
}

run "prod_scheduler_has_the_same_path_boundary" {
  command = apply

  variables {
    environment    = "prod"
    gcp_project_id = "desirelines-prod-test"
  }

  assert {
    condition = (
      contains(keys(local.python_readiness_targets), "deletion-service") &&
      contains(keys(local.python_readiness_targets), "postgres-writer") &&
      alltrue([for key, grant in google_cloud_run_v2_service_iam_member.scheduler_python_invoker :
        grant.project == "desirelines-prod-test" &&
        grant.name == local.python_readiness_targets[key].name &&
        grant.member == "serviceAccount:${google_service_account.scheduler.email}" &&
        grant.role == "roles/run.invoker" &&
        length(grant.condition) == 1 &&
        grant.condition[0].expression == "request.path == \"/ready\""
      ]) && length(google_cloud_run_v2_service_iam_member.scheduler_python_invoker) == length(local.python_readiness_targets)
    )
    error_message = "Prod must use its own scheduler with the same exact /ready restriction on every target."
  }
}
