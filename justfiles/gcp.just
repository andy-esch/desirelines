# Impersonate Terraform service account
auth-impersonate:
    @current_project=$(gcloud config get-value project); \
    echo "🔑 Impersonating terraform-desirelines@$current_project.iam.gserviceaccount.com..."; \
    gcloud config set auth/impersonate_service_account terraform-desirelines@$current_project.iam.gserviceaccount.com

# Stop impersonation
auth-stop:
    @echo "🔑 Stopping impersonation..."
    gcloud config unset auth/impersonate_service_account

# Check auth status
auth-status:
    @echo "🔍 Current authentication status:"
    @echo "Active account: $(gcloud config get-value account)"
    @echo "Impersonating: $(gcloud config get-value auth/impersonate_service_account)"

# Webhook Management (create, view, delete)
webhook action env:
    ./scripts/ops/webhook-management.sh {{action}} {{env}}

# Build and Publish Docker images (tag: optional git sha)
build-publish tag='':
    ./scripts/ops/deploy/build-and-publish.sh {{tag}}
