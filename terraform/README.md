# Terraform Infrastructure

Terraform modules and build infrastructure for Desirelines.

## Architecture

This repo contains **modules** and the **artifacts** environment only. Deployment environments (dev, prod) live in the private `desirelines-deploy` repo for GitOps with committed sensitive values.

| Location | Purpose |
|----------|---------|
| `modules/desirelines/` | Main infrastructure module (Cloud Run, PubSub, BigQuery, etc.) |
| `modules/github-actions-wif/` | Workload Identity Federation module |
| `environments/artifacts/` | Artifact Registry (shared across environments) |

## Prerequisites

- **Terraform** (version pinned in `.terraform-version`)
- **Python 3** for the cloud-free table lifecycle tests
- **Google Cloud SDK** authenticated
- **pre-commit** installed (for validation hooks)

## Module Development

Merge changes to `terraform/modules/` or `schemas/` into main. The
[release workflow](../.github/workflows/deploy.yml) publishes the next `tf-N` tag;
the deploy repository updates its module pins manually or through Renovate.

## Artifacts Environment

The `artifacts/` environment manages the Artifact Registry in the `desirelines-artifacts` GCP project. This rarely changes and is applied manually:

```bash
cd terraform/environments/artifacts
terraform init
terraform plan
terraform apply
```

## CI/CD

- **CI validation**: formatting, validation, module/lifecycle tests, TFLint and terraform-docs checks on PRs
- **Deployment**: Handled by `desirelines-deploy` repo

See [docs/guides/ci.md](../docs/guides/ci.md) for details.

## Local Tooling

```bash
just tf-fmt            # Format all .tf files
just tf-validate-all   # Validate all environments and modules
just tf-test           # Test contracts and table lifecycle without cloud credentials
just tf-lint           # Lint with TFLint (Google ruleset)
just tf-docs           # Regenerate module documentation
```

`tf-test` runs mocked contracts and [provider lifecycle plans](../scripts/ci/activity_table_lifecycle.py)
using synthetic state. Live validation follows the
[table-preservation checkpoint](../docs/runbooks/activity-row-schema-changes.md#verify-a-description-only-table-edit).

## Security

- State files stored in GCS with versioning
- Sensitive outputs marked with `sensitive = true`
- Sensitive tfvars committed only in the private deploy repo

## Related

- [Bootstrap Guide](../docs/guides/bootstrap.md) - Initial environment setup
- [Deployment Guide](../docs/guides/deployment.md) - Deployment procedures
- [CI Guide](../docs/guides/ci.md) - CI/CD pipeline
