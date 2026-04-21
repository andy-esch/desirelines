# Desirelines Infrastructure Module

Main Terraform module for the Desirelines project. Provisions all GCP resources for a single environment (dev or prod).

## Resources Managed

| File | Resources |
|------|-----------|
| `cloud_run.tf` | Cloud Run services (dispatcher, api-gateway, bq-inserter, postgres-writer, deletion-service), service accounts, IAM |
| `pubsub_subscriptions.tf` | Push subscriptions (activity + deauth), dead letter queues |
| `main.tf` | Pub/Sub topics (activity_events, deauth_events, dead_letter), BigQuery dataset/tables, Firestore database, Cloud Storage, GCP APIs |
| `firebase_hosting.tf` | Firebase Hosting site, custom domain, web app config |
| `image_validation.tf` | Container image tag validation pre-apply |
| `monitoring.tf` | Monitoring alerts and notification channels |

## Usage

This module is referenced by the private `desirelines-deploy` repo via git tags:

```hcl
module "desirelines" {
  source = "git::https://github.com/andy-esch/desirelines.git//terraform/modules/desirelines?ref=tf-N"

  gcp_project_id     = var.gcp_project_id
  gcp_project_number = var.gcp_project_number
  environment        = "dev"
  infisical_project_id = var.infisical_project_id
}
```

<!-- BEGIN_TF_DOCS -->
## Requirements

| Name | Version |
|------|---------|
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 1.12 |
| <a name="requirement_external"></a> [external](#requirement\_external) | ~> 2.3 |
| <a name="requirement_google"></a> [google](#requirement\_google) | ~> 7.22 |
| <a name="requirement_google-beta"></a> [google-beta](#requirement\_google-beta) | ~> 7.22 |

## Providers

| Name | Version |
|------|---------|
| <a name="provider_external"></a> [external](#provider\_external) | 2.3.5 |
| <a name="provider_google"></a> [google](#provider\_google) | 7.28.0 |
| <a name="provider_google-beta"></a> [google-beta](#provider\_google-beta) | 7.28.0 |
| <a name="provider_terraform"></a> [terraform](#provider\_terraform) | n/a |

## Resources

| Name | Type |
|------|------|
| [google-beta_google_firebase_hosting_custom_domain.app_subdomain](https://registry.terraform.io/providers/hashicorp/google-beta/latest/docs/resources/google_firebase_hosting_custom_domain) | resource |
| [google-beta_google_firebase_hosting_site.web_app](https://registry.terraform.io/providers/hashicorp/google-beta/latest/docs/resources/google_firebase_hosting_site) | resource |
| [google-beta_google_firebase_web_app.web_app](https://registry.terraform.io/providers/hashicorp/google-beta/latest/docs/resources/google_firebase_web_app) | resource |
| [google_bigquery_dataset.activities_dataset](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_dataset) | resource |
| [google_bigquery_dataset_iam_member.backfill_data_editor](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_dataset_iam_member) | resource |
| [google_bigquery_dataset_iam_member.bq_inserter_data_editor](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_dataset_iam_member) | resource |
| [google_bigquery_dataset_iam_member.deletion_service_data_editor](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_dataset_iam_member) | resource |
| [google_bigquery_dataset_iam_member.developer_owner](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_dataset_iam_member) | resource |
| [google_bigquery_table.activities](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_table) | resource |
| [google_bigquery_table.activities_staging](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_table) | resource |
| [google_bigquery_table.deleted_activities](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/bigquery_table) | resource |
| [google_cloud_run_v2_job.backfill](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_job) | resource |
| [google_cloud_run_v2_service.api_gateway](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service) | resource |
| [google_cloud_run_v2_service.bq_inserter](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service) | resource |
| [google_cloud_run_v2_service.deletion_service](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service) | resource |
| [google_cloud_run_v2_service.dispatcher](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service) | resource |
| [google_cloud_run_v2_service.postgres_writer](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service) | resource |
| [google_cloud_run_v2_service_iam_member.api_gateway_public_access](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service_iam_member) | resource |
| [google_cloud_run_v2_service_iam_member.bq_inserter_eventarc_invoker](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service_iam_member) | resource |
| [google_cloud_run_v2_service_iam_member.deletion_service_invoker](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service_iam_member) | resource |
| [google_cloud_run_v2_service_iam_member.dispatcher_public_access](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service_iam_member) | resource |
| [google_cloud_run_v2_service_iam_member.postgres_writer_eventarc_invoker](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/cloud_run_v2_service_iam_member) | resource |
| [google_firestore_database.user_configs](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/firestore_database) | resource |
| [google_monitoring_alert_policy.apigateway_uptime](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.dlq_bq_inserter](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.dlq_postgres_writer](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.firestore_operation_latency](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.frontend_uptime](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.http_request_latency](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.old_messages](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.postgres_pool_exhaustion](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.postgres_query_latency](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.pubsub_publish_latency](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.service_4xx_errors](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.service_5xx_errors](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_alert_policy.strava_api_latency](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy) | resource |
| [google_monitoring_dashboard.desirelines_observability](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_dashboard) | resource |
| [google_monitoring_notification_channel.email_alerts](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_notification_channel) | resource |
| [google_monitoring_uptime_check_config.apigateway_health](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_uptime_check_config) | resource |
| [google_monitoring_uptime_check_config.frontend_root](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_uptime_check_config) | resource |
| [google_project_iam_member.api_gateway_firestore](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.api_gateway_monitoring](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.api_gateway_tracing](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.backfill_bigquery_job_user](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.backfill_firestore](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.bq_inserter_bigquery_job_user](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.bq_inserter_monitoring](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.bq_inserter_tracing](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.deletion_service_bigquery_job_user](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.deletion_service_firestore](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.deletion_service_monitoring](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.deletion_service_tracing](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.dispatcher_firestore](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.dispatcher_monitoring](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.dispatcher_tracing](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.infisical_secret_admin](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.infisical_service_usage_admin](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.postgres_writer_monitoring](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_iam_member.postgres_writer_tracing](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_iam_member) | resource |
| [google_project_service.firebase](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_service) | resource |
| [google_project_service.firebase_hosting](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_service) | resource |
| [google_project_service.required_apis](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/project_service) | resource |
| [google_pubsub_subscription.bq_inserter](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_subscription) | resource |
| [google_pubsub_subscription.bq_inserter_dlq](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_subscription) | resource |
| [google_pubsub_subscription.dead_letter_monitoring](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_subscription) | resource |
| [google_pubsub_subscription.deletion_service](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_subscription) | resource |
| [google_pubsub_subscription.deletion_service_dlq](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_subscription) | resource |
| [google_pubsub_subscription.postgres_writer](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_subscription) | resource |
| [google_pubsub_subscription.postgres_writer_dlq](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_subscription) | resource |
| [google_pubsub_subscription_iam_member.dlq_subscriber](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_subscription_iam_member) | resource |
| [google_pubsub_topic.activity_events](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_topic) | resource |
| [google_pubsub_topic.dead_letter](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_topic) | resource |
| [google_pubsub_topic.deauth_events](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_topic) | resource |
| [google_pubsub_topic_iam_member.dead_letter_publisher](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_topic_iam_member) | resource |
| [google_pubsub_topic_iam_member.dispatcher_deauth_publisher](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_topic_iam_member) | resource |
| [google_pubsub_topic_iam_member.dispatcher_publisher](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/pubsub_topic_iam_member) | resource |
| [google_secret_manager_secret.allowed_emails](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.auth_state_secret](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.postgres_conn_admin](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.postgres_conn_apigateway](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.postgres_conn_flyway](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.postgres_conn_reader](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.postgres_conn_writer](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.strava_client_id](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.strava_client_secret](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.strava_webhook_subscription_id](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret.strava_webhook_verify_token](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret) | resource |
| [google_secret_manager_secret_iam_member.api_gateway_allowed_emails_access](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_secret_manager_secret_iam_member.api_gateway_postgres_access](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_secret_manager_secret_iam_member.api_gateway_strava_oauth_secrets](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_secret_manager_secret_iam_member.backfill_postgres_access](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_secret_manager_secret_iam_member.backfill_strava_api_secrets](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_secret_manager_secret_iam_member.deletion_service_postgres_access](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_secret_manager_secret_iam_member.dispatcher_api_tokens](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_secret_manager_secret_iam_member.dispatcher_webhook_tokens](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_secret_manager_secret_iam_member.postgres_developer_access](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_secret_manager_secret_iam_member.postgres_writer_postgres_access](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/secret_manager_secret_iam_member) | resource |
| [google_service_account.api_gateway](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account) | resource |
| [google_service_account.backfill](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account) | resource |
| [google_service_account.bq_inserter](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account) | resource |
| [google_service_account.deletion_service](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account) | resource |
| [google_service_account.dispatcher](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account) | resource |
| [google_service_account.infisical_sync](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account) | resource |
| [google_service_account.postgres_writer](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account) | resource |
| [google_service_account_iam_member.api_gateway_impersonation](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |
| [google_service_account_iam_member.api_gateway_token_creator](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |
| [google_service_account_iam_member.backfill_impersonation](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |
| [google_service_account_iam_member.bq_inserter_impersonation](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |
| [google_service_account_iam_member.deletion_service_impersonation](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |
| [google_service_account_iam_member.dispatcher_impersonation](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |
| [google_service_account_iam_member.infisical_cloud_impersonation](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |
| [google_service_account_iam_member.infisical_token_creator](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |
| [google_service_account_iam_member.postgres_writer_impersonation](https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/service_account_iam_member) | resource |
| [terraform_data.image_validation](https://registry.terraform.io/providers/hashicorp/terraform/latest/docs/resources/data) | resource |

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|:--------:|
| <a name="input_environment"></a> [environment](#input\_environment) | Environment name (local, dev, prod) | `string` | n/a | yes |
| <a name="input_external_artifact_registry"></a> [external\_artifact\_registry](#input\_external\_artifact\_registry) | Artifact Registry URL for container images. Format: REGION-docker.pkg.dev/PROJECT\_ID/REPO\_NAME | `string` | n/a | yes |
| <a name="input_gcp_project_id"></a> [gcp\_project\_id](#input\_gcp\_project\_id) | Google Cloud Project ID | `string` | n/a | yes |
| <a name="input_gcp_project_number"></a> [gcp\_project\_number](#input\_gcp\_project\_number) | Google Cloud Project Number (needed for service account IAM) | `string` | n/a | yes |
| <a name="input_infisical_project_id"></a> [infisical\_project\_id](#input\_infisical\_project\_id) | Infisical Project ID (used as suffix for integration Service Account) | `string` | n/a | yes |
| <a name="input_api_gateway_allowed_origins"></a> [api\_gateway\_allowed\_origins](#input\_api\_gateway\_allowed\_origins) | Comma-separated list of allowed CORS origins for API Gateway | `string` | `""` | no |
| <a name="input_app_config"></a> [app\_config](#input\_app\_config) | Application configuration values from Infisical | <pre>object({<br/>    log_level         = string<br/>    frontend_url      = optional(string, "")<br/>    auth_callback_url = optional(string, "")<br/>  })</pre> | <pre>{<br/>  "log_level": "INFO"<br/>}</pre> | no |
| <a name="input_bigquery_location"></a> [bigquery\_location](#input\_bigquery\_location) | BigQuery dataset location | `string` | `"US"` | no |
| <a name="input_deployment_version"></a> [deployment\_version](#input\_deployment\_version) | Version tag for all deployed code (Cloud Run images and Cloud Function source packages). Typically a git SHA for code provenance and observability (e.g., 'b30d6ea' or 'latest') | `string` | `"latest"` | no |
| <a name="input_developer_email"></a> [developer\_email](#input\_developer\_email) | Email of the developer account for BigQuery console access (optional) | `string` | `null` | no |
| <a name="input_enable_apis"></a> [enable\_apis](#input\_enable\_apis) | Whether to enable required GCP APIs | `bool` | `true` | no |
| <a name="input_enable_application_metric_alerts"></a> [enable\_application\_metric\_alerts](#input\_enable\_application\_metric\_alerts) | Gate for alert policies that reference custom OTel application metrics (postgres pool exhaustion, Strava/HTTP/Postgres/Firestore/PubSub latency tails). These policies target custom.googleapis.com/desirelines.io/* metric descriptors, which are auto-created by the OTel GCP exporter the first time the app emits each metric — so on a first-ever deploy they don't exist yet and `google_monitoring_alert_policy` returns 404 when it tries to bind to them. Leave false on the initial deploy; after the services have run long enough to flush at least one metrics batch (≥ 60s), flip true on a follow-up apply. | `bool` | `false` | no |
| <a name="input_firestore_location"></a> [firestore\_location](#input\_firestore\_location) | Firestore database location (region ID, e.g., 'us-central1') | `string` | `"us-central1"` | no |
| <a name="input_gcp_region"></a> [gcp\_region](#input\_gcp\_region) | Default GCP region | `string` | `"us-central1"` | no |
| <a name="input_project_name"></a> [project\_name](#input\_project\_name) | Name of the project (used for resource naming) | `string` | `"desirelines"` | no |
| <a name="input_slack_notification_channel_id"></a> [slack\_notification\_channel\_id](#input\_slack\_notification\_channel\_id) | Full resource ID of an externally-managed Slack notification channel (format: projects/<project>/notificationChannels/<id>). Created once via GCP Console → Monitoring → Notification Channels → Slack OAuth flow; the channel is not managed by Terraform because the OAuth token is issued through the Console and kept out of state. Leave null to skip Slack notifications for this environment. | `string` | `null` | no |

## Outputs

| Name | Description |
|------|-------------|
| <a name="output_alert_policy_ids"></a> [alert\_policy\_ids](#output\_alert\_policy\_ids) | IDs of created alert policies |
| <a name="output_application_config"></a> [application\_config](#output\_application\_config) | Configuration values needed by the applications |
| <a name="output_bigquery_dataset_id"></a> [bigquery\_dataset\_id](#output\_bigquery\_dataset\_id) | ID of the BigQuery dataset |
| <a name="output_bigquery_table_full_id"></a> [bigquery\_table\_full\_id](#output\_bigquery\_table\_full\_id) | Full ID of the activities BigQuery table (project:dataset.table) |
| <a name="output_bigquery_table_id"></a> [bigquery\_table\_id](#output\_bigquery\_table\_id) | ID of the activities BigQuery table |
| <a name="output_cloud_run_urls"></a> [cloud\_run\_urls](#output\_cloud\_run\_urls) | Cloud Run service URLs (stable, do not change on redeploy) |
| <a name="output_deployment_info"></a> [deployment\_info](#output\_deployment\_info) | Deployment provenance: image registry and version tag |
| <a name="output_firebase_custom_domain"></a> [firebase\_custom\_domain](#output\_firebase\_custom\_domain) | Custom domain for Firebase Hosting (production only) |
| <a name="output_firebase_hosting_site_id"></a> [firebase\_hosting\_site\_id](#output\_firebase\_hosting\_site\_id) | Firebase Hosting site ID for web application |
| <a name="output_firebase_hosting_url"></a> [firebase\_hosting\_url](#output\_firebase\_hosting\_url) | Default Firebase Hosting URL for web application |
| <a name="output_firebase_web_app_config"></a> [firebase\_web\_app\_config](#output\_firebase\_web\_app\_config) | Firebase Web App configuration for frontend .env files |
| <a name="output_firestore_database_location"></a> [firestore\_database\_location](#output\_firestore\_database\_location) | Location of the Firestore database |
| <a name="output_firestore_database_name"></a> [firestore\_database\_name](#output\_firestore\_database\_name) | Name of the Firestore database |
| <a name="output_monitoring_dashboard_url"></a> [monitoring\_dashboard\_url](#output\_monitoring\_dashboard\_url) | URL to the GCP Monitoring Dashboard |
| <a name="output_pubsub_dead_letter_topic_name"></a> [pubsub\_dead\_letter\_topic\_name](#output\_pubsub\_dead\_letter\_topic\_name) | Name of the dead letter PubSub topic |
| <a name="output_pubsub_subscription_names"></a> [pubsub\_subscription\_names](#output\_pubsub\_subscription\_names) | Names of Pub/Sub subscriptions for event processing |
| <a name="output_pubsub_topic_name"></a> [pubsub\_topic\_name](#output\_pubsub\_topic\_name) | Name of the main PubSub topic for activity events |
| <a name="output_resource_names"></a> [resource\_names](#output\_resource\_names) | Map of all resource names for easy reference |
| <a name="output_service_accounts"></a> [service\_accounts](#output\_service\_accounts) | Service account emails for each service |
| <a name="output_service_names"></a> [service\_names](#output\_service\_names) | Names of deployed services and jobs (Cloud Run) |
<!-- END_TF_DOCS -->

## Related

- [Terraform README](../../README.md) - Module versioning and tagging workflow
- [Bootstrap Guide](../../../docs/guides/bootstrap.md) - Initial environment setup
- [Deployment Guide](../../../docs/guides/deployment.md) - Deployment procedures
- [GitHub Actions WIF Module](../github-actions-wif/README.md) - CI/CD authentication
