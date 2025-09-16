.PHONY: help deploy test local lint format typecheck py-test py-lint py-format js-lint js-format js-dev start stop logs clean build

# GCP Configuration - automatically detected from gcloud config
GCP_PROJECT_ID ?= $(shell gcloud config get-value project)

# Helper function to validate environment argument and project alignment
define check_env
	@if [ -z "$(filter dev prod,$(MAKECMDGOALS))" ]; then \
		echo "❌ Error: Please specify environment: make $(1) dev|prod"; \
		exit 1; \
	fi
	@ENV_NAME=$$(echo "$(MAKECMDGOALS)" | grep -o -E "(dev|prod)"); \
	EXPECTED_PROJECT="desirelines-$$ENV_NAME"; \
	CURRENT_PROJECT="$(GCP_PROJECT_ID)"; \
	if [ "$$CURRENT_PROJECT" != "$$EXPECTED_PROJECT" ]; then \
		echo "❌ Error: gcloud project mismatch!"; \
		echo "   Expected: $$EXPECTED_PROJECT"; \
		echo "   Current:  $$CURRENT_PROJECT"; \
		echo "   Run: gcloud config set project $$EXPECTED_PROJECT"; \
		exit 1; \
	fi
endef

# Python commands
py-test:
	uv run pytest packages/desirelines/tests/ && uv run pytest packages/stravabqsync/tests/

py-lint:
	uv run ruff check . --fix

py-format:
	uv run ruff format .

py-typecheck:
	uv run mypy packages/desirelines/src/ && uv run mypy packages/stravabqsync/src/

# Go commands
go-test:
	@echo "🧪 Running Go tests for local packages..."
	cd packages/dispatcher && go test -v ./...

go-test-all:
	@echo "🧪 Running all Go tests in workspace (parallelism=2)..."
	go test -v -p 2 all

go-test-coverage:
	cd packages/dispatcher && go test -coverprofile=coverage.out ./... && go tool cover -html=coverage.out -o coverage.html

go-lint:
	cd packages/dispatcher && go vet ./...

go-format:
	cd packages/dispatcher && go fmt ./...

go-build:
	cd packages/dispatcher && go build -v .

# JavaScript commands
js-lint:
	cd web && npm run lint || echo "⚠️  No lint script found in web/"

js-format:
	cd web && npm run format || echo "⚠️  No format script found in web/"

js-dev:
	cd web && npm start

# ==========================================
# Service Account Management
# ==========================================

# Service Account Management
.PHONY: impersonate-terraform
impersonate-terraform:
	$(call check_env,impersonate-terraform)
	@ENV_NAME=$(filter dev prod,$(MAKECMDGOALS)) && \
	echo "🔑 Impersonating terraform-desirelines-$$ENV_NAME service account..." && \
	gcloud config set auth/impersonate_service_account terraform-desirelines-$$ENV_NAME@$(GCP_PROJECT_ID).iam.gserviceaccount.com && \
	echo "✅ Now using terraform-desirelines-$$ENV_NAME@$(GCP_PROJECT_ID).iam.gserviceaccount.com"

.PHONY: stop-impersonate
stop-impersonate:
	@echo "🔑 Stopping service account impersonation..."
	@gcloud config unset auth/impersonate_service_account
	@echo "✅ Now using your user account"

.PHONY: check-auth
check-auth:
	@echo "🔍 Current authentication status:"
	@echo "Active account: $$(gcloud config get-value account)"
	@echo "Impersonating: $$(gcloud config get-value auth/impersonate_service_account || echo 'None')"

# ==========================================
# Terraform Operations
# ==========================================

.PHONY: tf-local-init
tf-local-init:
	@echo "🏗️ Initializing local Terraform environment..."
	@cd terraform/environments/local && terraform init

.PHONY: tf-local-plan
tf-local-plan:
	@echo "📋 Planning local Terraform deployment..."
	@cd terraform/environments/local && terraform plan

.PHONY: tf-local-apply
tf-local-apply:
	@echo "🚀 Applying local Terraform deployment..."
	@cd terraform/environments/local && terraform apply

.PHONY: tf-local-destroy
tf-local-destroy:
	@echo "💥 Destroying local Terraform resources..."
	@cd terraform/environments/local && terraform destroy

# Combined workflows
.PHONY: setup-local
setup-local: impersonate-terraform tf-local-init tf-local-plan
	@echo "✅ Local environment ready! Run 'make tf-local-apply' to create resources."

# Help target
help:
	@echo "Available targets:"
	@echo ""
	@echo "Authentication:"
	@echo "  impersonate-terraform  - Impersonate terraform service account"
	@echo "  stop-impersonate      - Stop impersonating service account"
	@echo "  check-auth            - Show current authentication status"
	@echo ""
	@echo "Terraform (Local):"
	@echo "  tf-local-init         - Initialize local Terraform"
	@echo "  tf-local-plan         - Plan local deployment"
	@echo "  tf-local-apply        - Apply local deployment"
	@echo "  tf-local-destroy      - Destroy local resources"
	@echo "  setup-local           - Complete local environment setup"
	@echo ""
	@echo "Local Development (Docker):"
	@echo "  start          - Start all functions locally (PubSub emulator + local storage)"
	@echo "  start-local    - Start functions with Terraform-managed GCP resources"
	@echo "  stop           - Stop all functions and cleanup"
	@echo "  logs           - View logs from all functions"
	@echo "  logs-dispatcher - View activity-dispatcher logs"
	@echo "  logs-aggregator - View activity-aggregator logs"
	@echo "  logs-bq        - View activity-bq-inserter logs"
	@echo "  test-full-flow - Test complete webhook flow"
	@echo "  build          - Build all Docker images"
	@echo "  clean          - Clean up Docker resources"
	@echo ""
	@echo "Code Quality:"
	@echo "  test           - Run all tests (Python + fast Go tests)"
	@echo "  lint           - Run all linters (Python + Go)"
	@echo "  format         - Format all code (Python + Go)"
	@echo "  py-test        - Run Python tests only"
	@echo "  go-test        - Run fast Go tests for local packages"
	@echo "  go-test-all    - Run all Go tests in the workspace (more intensive)"
	@echo "  go-test-coverage - Run Go tests with coverage report"
	@echo ""
	@echo "Secret Management & Webhooks:"
	@echo "  deploy-secrets dev|prod SECRET_FILE=file.json - Deploy secrets from JSON file with IAM bindings"
	@echo "  create-webhook dev|prod       - Create webhook subscription"
	@echo "  view-subscription dev|prod    - View webhook subscriptions"
	@echo "  delete-subscription dev|prod  - Delete webhook subscription"
	@echo "  generate-webhook-verify-token - Generate and store secure webhook verify token"
	@echo "  rotate-webhook-verify-token   - Rotate webhook token and update webhook"
	@echo ""
	@echo "GCP Deployment:"
	@echo "  Use Terraform for deployment (see terraform/ directory)"

# Combined commands
test: py-test go-test
lint: py-lint go-lint
format: py-format go-format


# ==========================================
# Docker-based Local Development
# ==========================================

# Start all functions locally with PubSub emulator
start: generate-requirements
	@echo "🚀 Starting all functions locally (PubSub emulator + local storage)..."
	docker compose up --build --detach
	@echo "✅ All services are running!"
	@echo "📋 Service URLs:"
	@echo "  Dispatcher: http://localhost:8081"
	@echo "  Aggregator: http://localhost:8082"
	@echo "  BQ Inserter: http://localhost:8083"
	@echo "  PubSub Emulator: http://localhost:8085"
	@echo ""
	@echo "🧪 Test the full flow:"
	@echo "  make test-full-flow"

# Start all functions with local Terraform-managed GCP resources (hybrid mode)
start-local: generate-requirements
	@echo "🚀 Starting functions with local GCP resources (PubSub emulator + Terraform-created BigQuery/Storage)..."
	@if [ ! -f "$$HOME/.config/gcloud/application_default_credentials.json" ]; then \
		echo "❌ Error: No gcloud application default credentials found"; \
		echo "   Please run: gcloud auth application-default login --impersonate-service-account=terraform-desirelines@$(GCP_PROJECT_ID).iam.gserviceaccount.com"; \
		echo "   This will authenticate your local environment for BigQuery access"; \
		exit 1; \
	fi
	docker compose -f docker-compose.yml -f docker-compose.local.yml up --build --detach
	@echo "✅ All services are running with local GCP resources!"
	@echo "📋 Service URLs:"
	@echo "  Dispatcher: http://localhost:8081"
	@echo "  Aggregator: http://localhost:8082"
	@echo "  BQ Inserter: http://localhost:8083 (→ Terraform-managed BigQuery)"
	@echo "  PubSub Emulator: http://localhost:8085"
	@echo ""
	@echo "🧪 Test the full flow:"
	@echo "  make test-full-flow"
	@echo ""
	@echo "💡 Data will be written to: desirelines_dataset_local.activities"
	@echo "🔐 Using your gcloud application default credentials with service account impersonation"

# Stop services and cleanup
stop:
	@echo "🛑 Stopping all functions..."
	docker compose down
	rm -f functions/requirements-*.txt

# Generate function-specific requirements files
generate-requirements:
	@echo "📋 Generating function-specific requirements..."
	@echo "  - Desirelines package requirements"
	cd packages/desirelines && uv export --format requirements-txt --no-dev --no-editable > ../../functions/requirements-desirelines.txt
	@echo "  - Removing local package references from desirelines requirements"
	sed -i '' '/^\.\/packages\/desirelines$$/d' functions/requirements-desirelines.txt
	@echo "  - Stravabqsync package requirements"
	cd packages/stravabqsync && uv export --format requirements-txt --no-dev --no-editable > ../../functions/requirements-stravabqsync.txt
	@echo "  - Removing local package references from stravabqsync requirements"
	sed -i '' '/^\.\/packages\/stravabqsync$$/d' functions/requirements-stravabqsync.txt
	sed -i '' '/^\.\/packages\/desirelines$$/d' functions/requirements-stravabqsync.txt

# Build all images
build: generate-requirements
	@echo "🔨 Building all Docker images..."
	docker compose build

# View logs
logs:
	docker compose logs -f

logs-dispatcher:
	docker compose logs -f activity-dispatcher

logs-aggregator:
	docker compose logs -f activity-aggregator

logs-bq:
	docker compose logs -f activity-bq-inserter

# Test the full end-to-end flow
test-full-flow:
	@echo "🧪 Testing full Strava webhook flow..."
	@echo "1️⃣ Sending webhook to dispatcher..."
	curl -X POST http://localhost:8081 \
		-H "Content-Type: application/json" \
		-d '{"object_type": "activity", "object_id": 123, "aspect_type": "create", "owner_id": 456}'
	@echo ""
	@echo "✅ Check the logs to see if messages flowed through:"
	@echo "  make logs"

# Clean up Docker resources
clean:
	@echo "🧹 Cleaning up Docker resources..."
	docker compose down --rmi all --volumes --remove-orphans
	docker system prune -f
	rm -f functions/requirements-*.txt




# ==========================================
# Secret Management & Webhooks
# ==========================================

deploy-secrets:
	$(call check_env,deploy-secrets)
	@if [ -z "$(SECRET_FILE)" ]; then \
		echo "❌ Error: Please specify secret file: make deploy-secrets dev SECRET_FILE=strava-auth-dev.json"; \
		exit 1; \
	fi
	@./scripts/deploy-secrets.sh $(filter dev prod,$(MAKECMDGOALS)) $(SECRET_FILE)

create-webhook:
	$(call check_env,create-webhook)
	@./scripts/webhook-management.sh create $(filter dev prod,$(MAKECMDGOALS))

view-subscription:
	$(call check_env,view-subscription)
	@./scripts/webhook-management.sh view $(filter dev prod,$(MAKECMDGOALS))

delete-subscription:
	$(call check_env,delete-subscription)
	@./scripts/webhook-management.sh delete $(filter dev prod,$(MAKECMDGOALS))

generate-webhook-verify-token:
	@./scripts/webhook-management.sh generate-token dev

rotate-webhook-verify-token:
	@./scripts/webhook-management.sh rotate-token dev

# Dummy targets for environment arguments
dev prod:
	@:


site-start:
	cd web && npm start

site-build:
	cd web && npm run build
