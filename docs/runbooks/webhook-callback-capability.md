# Strava webhook callback-capability cutover

This runbook moves the dispatcher from the public `/webhook` callback to
`/webhook/<capability>`. The capability is a bearer credential, not a Strava
payload signature. Never paste the value or complete callback URL into tickets,
task files, chat, screenshots, commands, dashboards, or logs.

## Preconditions

- D-1 deauthorization grant confirmation is deployed and healthy.
- The dispatcher build supports `WEBHOOK_ROUTE_MODE=legacy|dual|capability`.
- Terraform has created `INFISICAL_STRAVA_WEBHOOK_CALLBACK_CAPABILITY` in the
  target project, and Infisical is still the authoritative value source.
- The callback capability has an enabled numeric Secret Manager version. Record
  the version number, not the value; `dual` and `capability` deployments refuse
  an unpinned or `latest` reference.
- Terraform has applied the narrowly scoped
  `exclude-dispatcher-webhook-callback-capability` Cloud Logging exclusion.
  It excludes raw or percent-encoded capability-shaped callback URLs and legacy
  verification GETs, whose query contains `hub.verify_token`.
- The target environment has its own CSPRNG-generated 32-byte value encoded as
  exactly 64 lowercase hexadecimal characters. Do not reuse another
  environment's value or any existing Strava credential.
- The operator can update `INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID` immediately
  after Strava creates the replacement subscription.
- The matching `desirelines` module tag is selected in the
  `desirelines-deploy` repository before its `app_config` sets
  `dispatcher_webhook_route_mode`, and its module call sets
  `dispatcher_webhook_callback_capability_secret_version`. The CI deploy identity
  already declares `roles/logging.configWriter` in both environments.

## Activation gate: prove the URL is not retained

Do this in development with a disposable canary capability before registering
the real callback:

1. Sync the canary value and note its numeric Secret Manager version. In the
   `desirelines-deploy` development environment, update the module tag, set
   `dispatcher_webhook_route_mode = "dual"`, set
   `dispatcher_webhook_callback_capability_secret_version` on the module call to
   that number, and apply.
2. Send one valid verification-shaped GET and one invalid POST to the capability
   route without printing the URL. Use a client that supplies its configuration
   over stdin rather than putting the URL in process argv.
3. Confirm the Logging exclusion is enabled, then search application logs,
   Cloud Run `run.googleapis.com/requests` logs, Cloud
   Trace span names and attributes, and HTTP metric labels for the exact canary.
4. The application must expose only `/webhook/[redacted]` and the metric route
   template. The capability outcome metric may contain only `accepted`,
   `rejected`, or `legacy`. A rejected probe may leave one redacted application
   log with bounded method and client IP, but never its target or user-agent.
5. Inspect any additional user-defined sinks in the project; the project-level
   exclusion protects the default sink but must not be assumed to govern an
   independently configured export.
6. If any retained surface contains the canary, stop. Correct the exclusion or
   use an authenticated relay. Rotate away from the exposed canary before
   continuing.

Do not use the real callback capability until this gate passes. Application-side
redaction cannot alter the request URL that the Cloud Run platform observed
before handing the request to the container.

## Development activation rehearsal

Development deliberately receives no live Strava webhooks, so do not delete or
recreate the application's sole Strava subscription here. Development provides
telemetry evidence, not a live-delivery rehearsal:

1. Complete the activation gate above with a disposable development-only canary.
2. Confirm the revision is healthy. A missing, empty, uppercase, non-64-character,
   or unpinned capability must fail startup or Terraform validation rather than
   silently leave an open route.
3. Send a verification-shaped GET with the valid capability and current dev
   verify token; confirm the challenge succeeds. Send a validly shaped POST with
   the capability but a deliberately wrong subscription ID; confirm it reaches
   the existing defense-in-depth check and returns `401` without publishing.
4. Exercise the non-canonical variants from the activation gate and confirm the
   fixed redacted rejection log is the only application evidence they retain.
5. Rotate away from the disposable canary by creating a new value/version and
   updating the pinned version through GitOps. Leave dev in `capability` mode and
   confirm plain GET and POST `/webhook` are generic `404`s.

## Production cutover

1. Generate and sync a production-only capability; do not promote the dev value.
   Record its numeric Secret Manager version without reading the value into
   operator output.
2. In `desirelines-deploy`, update the module tag and set production's route mode
   to `dual` plus the pinned capability version. Apply and verify the healthy
   revision while the existing plain callback continues to deliver.
3. Delete the current Strava subscription. This starts the accepted delivery gap.
4. Run `scripts/ops/webhook-management.sh create prod`. The script reads the
   exact secret version mounted by the deployed revision—not `latest`—and shows
   only `[redacted capability URL]`.
5. Store the returned numeric ID in
   `INFISICAL_STRAVA_WEBHOOK_SUBSCRIPTION_ID`, wait for sync, and restart or wait
   for the dispatcher's secret-cache refresh.
6. Create or update an owned activity. Confirm the callback metric records
   `accepted`, the normal pipeline completes, and `legacy` stops incrementing.
7. Set production to `capability`, apply, and prove plain GET and POST `/webhook`
   return the same generic `404` with no downstream work.

Record the start/end of the subscription gap, the old and new subscription IDs,
the deployed revisions, and the operator. Do not record the callback URL.

## Rollback

Before the old subscription is deleted, rollback is just a GitOps return to the
previous route mode/version. After deletion, keep or return to `dual` and use the
management script to recreate the subscription against the deployed pinned
capability, then update the newly assigned subscription ID. If the capability
implementation itself must be rolled back to a legacy-only build, recreate the
plain callback with an audited stdin-only request; the D-3 script intentionally
does not offer a casual plain-route creation mode. Every recreation produces a
new subscription ID; restoring an old secret value does not restore a deleted
subscription.

After rollback, determine whether the capability was exposed. If exposure is
possible, replace it before another cutover attempt.

## Emergency rotation

1. Move to `dual` and verify the revision before changing the pinned capability.
2. Delete the compromised subscription so Strava stops sending the old URL.
3. Generate and sync a new environment-specific capability, record its numeric
   version, and change the GitOps pin. Never overwrite or disable the old version
   before the new revision is healthy.
4. Redeploy `dual`, repeat the telemetry activation gate with the new value, and
   recreate the subscription using the management script.
5. Update the new subscription ID, verify an owned event, and return to
   `capability` mode.
6. Search for and remove any retained copy of the compromised URL under the
   project's incident-data policy.

The task is not complete while either environment remains in `legacy` or `dual`,
or while migration-only route code remains in the final application.

## Observability tradeoff

The Logging exclusion intentionally removes matching Cloud Run
`run.googleapis.com/requests` entries from the `_Default` bucket, including
successful capability-route deliveries. Redacted application request logs and
the callback outcome metric are the replacement; rejected probes additionally
emit a fixed-path application warning with bounded method and client IP. Cloud
Run platform request-count/latency metrics remain available, and project-scoped
log-based metrics are calculated before `_Default` exclusions.

The project currently has no user-defined log sink. A future sink is not covered
by this `_Default` exclusion and must independently exclude capability-shaped
dispatcher request URLs before it is enabled.
