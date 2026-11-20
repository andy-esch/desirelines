# GitHub Actions Workload Identity Federation

GitHub Actions exchanges its OIDC token for short-lived GCP credentials.
Provider and service-account identifiers are configuration; service-account
keys are not required.

## Credential routes

| Caller | Identity | Scope |
|---|---|---|
| [Image builds](../../.github/workflows/deploy.yml) | `github-actions-deploy` in the build project | Push images to the shared Artifact Registry |
| Deploy-repo backend, frontend and maintenance workflows | Target environment's `ci-deploy` | Deploy or inspect that environment |

The deploy workflows select the target GitHub Environment and its
`WIF_PROVIDER` / `WIF_SERVICE_ACCOUNT` secrets. The public image workflow uses
repository secrets for its separate build identity. Configure each repository's
intended identity; copying deploy credentials into the build route grants the
wrong authority.

[The WIF module](../../terraform/modules/github-actions-wif/main.tf) owns provider
conditions, repository bindings and account roles. Build-only invocations set
`grant_default_roles = false`; shared-registry grants are managed in the
[artifacts configuration](../../terraform/environments/artifacts/main.tf).
The deploy repository owns the environment module invocations and credential
provisioning.

The current module condition restricts the GitHub owner, and the account binding
restricts the repository. Do not assume it also enforces branch or environment
claims: inspect the actual condition and binding.

## Setup and changes

Use the [bootstrap guide](bootstrap.md) for a new environment. For existing
infrastructure, change the managed deployment configuration and use its reviewed
plan/apply workflow. Keep the two account roles above separate.

Set these identifiers at the scope used by the caller:

| GitHub secret | Value |
|---|---|
| `WIF_PROVIDER` | `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/providers/PROVIDER_ID` |
| `WIF_SERVICE_ACCOUNT` | Intended service-account email |

Read pool/provider IDs from the environment configuration or live resource
metadata; module defaults are not proof of the deployed names. The module
exposes [`wif_provider` and `wif_service_account`](../../terraform/modules/github-actions-wif/outputs.tf),
but root output names vary by environment. A build-account output is not the
deploy account.

## Verify and troubleshoot

For the public build account, these are read-only checks:

```bash
gcloud iam workload-identity-pools list \
  --project=desirelines-dev --location=global

gcloud iam service-accounts get-iam-policy \
  github-actions-deploy@desirelines-dev.iam.gserviceaccount.com \
  --project=desirelines-dev
```

For deploy authentication, inspect the target environment's provider and
`ci-deploy` binding instead. Check both service-account trust and effective
resource/project grants. Shared Artifact Registry access is expected; an
unrelated environment's administration privileges are not a credential fix.

Use a successful run and available audit records to confirm the actual account
and federated subject. Logging coverage varies: a quiet log window does not
prove an identity is unused. Correct the managed configuration rather than
destroying the WIF pool or adding broad roles to make a failing caller work.

See [Google's WIF audit examples](https://docs.cloud.google.com/iam/docs/audit-logging/examples-workload-identity)
and [GitHub's reusable-workflow secret rules](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).
