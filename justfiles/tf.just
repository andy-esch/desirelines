# Format all Terraform files recursively
tf-fmt:
    @echo "🎨 Formatting all Terraform files..."
    terraform fmt -recursive terraform/

# Run generic Terraform command (e.g. just tf dev plan)
tf env cmd +args='':
    cd terraform/environments/{{env}} && terraform {{cmd}} {{args}}

# Initialize Terraform for environment
tf-init env:
    just tf {{env}} init

# Plan Terraform for environment
tf-plan env +args='':
    just tf {{env}} plan {{args}}

# Apply Terraform for environment (Manual)
tf-apply env +args='':
    just tf {{env}} apply {{args}}

# Validate Terraform configuration for environment
tf-validate env:
    @echo "🔍 Validating Terraform in {{env}}..."
    cd terraform/environments/{{env}} && terraform init -backend=false && terraform validate

# Validate ALL Terraform configurations
tf-validate-all:
    just tf-validate artifacts
    just tf-validate dev
    just tf-validate prod
    @echo "🔍 Validating modules..."
    (cd terraform/modules/desirelines && terraform init -backend=false && terraform validate)
    (cd terraform/modules/github-actions-wif && terraform init -backend=false && terraform validate)
    @echo "✅ All Terraform configurations are valid!"

# Check for drift (plan -detailed-exitcode)
tf-drift env:
    #!/usr/bin/env bash
    echo "🔍 Checking for drift in {{env}}..."
    cd terraform/environments/{{env}}
    terraform plan -detailed-exitcode
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then echo "✅ No drift detected"; exit 0;
    elif [ $EXIT_CODE -eq 2 ]; then echo "⚠️  Drift detected!"; exit 0; # Don't fail the command
    else echo "❌ Error running plan"; exit 1; fi

# Safe terraform deploy with validation checks
# Usage: just tf-deploy dev
#        just tf-deploy prod
#        just tf-deploy dev sha=abc123
tf-deploy env sha=`git rev-parse --short HEAD`:
    #!/usr/bin/env bash
    set -euo pipefail

    ENV="{{env}}"
    SHA="{{sha}}"

    echo "🔒 Terraform Safe Deploy"
    echo "   Environment: $ENV"
    echo "   Commit SHA:  $SHA"
    echo ""

    # 1. Validate environment
    if [[ "$ENV" != "dev" && "$ENV" != "prod" ]]; then
        echo "❌ Error: Invalid environment '$ENV'"
        echo "   Valid environments: dev, prod"
        exit 1
    fi

    # 2. Check GCP project matches environment
    CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
    EXPECTED_PROJECT="desirelines-$ENV"
    if [[ "$CURRENT_PROJECT" != "$EXPECTED_PROJECT" ]]; then
        echo "❌ GCP Project Mismatch"
        echo "   Current:  $CURRENT_PROJECT"
        echo "   Expected: $EXPECTED_PROJECT"
        echo ""
        echo "   Fix: gcloud config set project $EXPECTED_PROJECT"
        exit 1
    fi
    echo "✅ GCP project: $CURRENT_PROJECT"

    # 3. Check impersonation matches environment
    CURRENT_IMPERSONATE=$(gcloud config get-value auth/impersonate_service_account 2>/dev/null || echo "")
    EXPECTED_IMPERSONATE="terraform-desirelines@desirelines-$ENV.iam.gserviceaccount.com"
    if [[ "$CURRENT_IMPERSONATE" != "$EXPECTED_IMPERSONATE" ]]; then
        echo "❌ Impersonation Mismatch"
        echo "   Current:  ${CURRENT_IMPERSONATE:-<not set>}"
        echo "   Expected: $EXPECTED_IMPERSONATE"
        echo ""
        echo "   Fix: just auth-impersonate"
        exit 1
    fi
    echo "✅ Impersonating: $CURRENT_IMPERSONATE"

    # 4. Check for uncommitted changes (warning only)
    if ! git diff --quiet HEAD 2>/dev/null; then
        echo "⚠️  Warning: You have uncommitted changes"
        echo "   Consider committing before deploying"
        echo ""
    fi

    # 5. Verify terraform is initialized
    if [[ ! -d "terraform/environments/$ENV/.terraform" ]]; then
        echo "❌ Terraform not initialized for $ENV"
        echo "   Fix: just tf-init $ENV"
        exit 1
    fi
    echo "✅ Terraform initialized"

    # 6. Show plan
    echo ""
    echo "📋 Running terraform plan..."
    echo "────────────────────────────────────────"
    cd "terraform/environments/$ENV"
    terraform plan -var="function_source_tag=$SHA" -out=tfplan

    # 7. Confirmation for prod
    if [[ "$ENV" == "prod" ]]; then
        echo ""
        echo "🚨 WARNING: You are about to deploy to PRODUCTION! 🚨"
        echo ""
        read -p "Type 'yes' to confirm: " CONFIRM
        if [[ "$CONFIRM" != "yes" ]]; then
            echo "❌ Deployment cancelled"
            rm -f tfplan
            exit 1
        fi
    else
        echo ""
        read -p "Apply this plan? (y/N): " CONFIRM
        if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
            echo "❌ Deployment cancelled"
            rm -f tfplan
            exit 1
        fi
    fi

    # 8. Apply
    echo ""
    echo "🚀 Applying terraform plan..."
    echo "────────────────────────────────────────"
    terraform apply tfplan
    rm -f tfplan

    echo ""
    echo "✅ Deployment complete!"
    echo "   Environment: $ENV"
    echo "   Commit SHA:  $SHA"
