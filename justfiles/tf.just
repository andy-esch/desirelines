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
