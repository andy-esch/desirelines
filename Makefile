.PHONY: help deploy test local lint format typecheck py-test py-lint py-format go-lint go-lint-fix js-lint js-format js-dev start stop logs clean build proto-gen proto-gen-go proto-gen-go-apigateway proto-gen-go-dispatcher proto-gen-python proto-gen-typescript proto-clean proto-fmt proto-lint sync-schemas sync-sport-config verify-schemas db-connect-local db-migrate-local db-clean-local db-connect-dev db-connect-prod db-connect-dev-ro db-connect-prod-ro db-migrate-dev db-migrate-dev-info db-migrate-prod db-migrate-prod-info db-clean-dev

# GCP Configuration - automatically detected from gcloud config
GCP_PROJECT_ID ?= $(shell gcloud config get-value project)

# Helper function to validate current project and detect environment
define check_project_and_run
	@CURRENT_PROJECT="$(GCP_PROJECT_ID)"; \
	if [ "$$CURRENT_PROJECT" = "desirelines-dev" ]; then \
		ENV_NAME="dev"; \
	elif [ "$$CURRENT_PROJECT" = "desirelines-prod" ]; then \
		ENV_NAME="prod"; \
	elif [ "$$CURRENT_PROJECT" = "desirelines-local" ]; then \
		ENV_NAME="local"; \
	else \
		echo "❌ Error: Invalid GCP project for desirelines!"; \
		echo "   Current:  $$CURRENT_PROJECT"; \
		echo "   Expected: desirelines-dev, desirelines-prod, or desirelines-local"; \
		echo "   Fix: gcloud config set project desirelines-dev"; \
		echo "   Or:  gcloud config set project desirelines-prod"; \
		echo "   Or:  gcloud config set project desirelines-local"; \
		exit 1; \
	fi; \
	$(1) $$ENV_NAME
endef

# Python commands
py-test:
	cd packages/stravapipe && uv run pytest tests/

py-test-coverage:
	cd packages/stravapipe && uv run pytest tests/ --cov=src --cov-report=xml --cov-report=term

py-lint:
	cd packages/stravapipe && uv run ruff check . --fix

py-format:
	cd packages/stravapipe && uv run ruff format .

py-typecheck:
	cd packages/stravapipe && uv run mypy src/

# Go commands
go-test:
	@echo "🧪 Running Go tests for local packages..."
	cd packages/dispatcher && go test -v ./...
	cd packages/apigateway && go test -v ./...

go-test-all:
	@echo "🧪 Running all Go tests in workspace (parallelism=2)..."
	go test -v -p 2 all

go-test-coverage:
	@echo "🧪 Running Go tests with coverage..."
	cd packages/dispatcher && go test -v -coverprofile=coverage.out -covermode=atomic ./...
	cd packages/apigateway && go test -v -coverprofile=coverage.out -covermode=atomic ./...

go-lint:
	@echo "🔍 Running golangci-lint..."
	golangci-lint run ./packages/dispatcher/... ./packages/apigateway/...

go-lint-fix:
	@echo "🔧 Running golangci-lint with auto-fix..."
	golangci-lint run --fix ./packages/dispatcher/... ./packages/apigateway/...

go-format:
	cd packages/dispatcher && go fmt ./...
	cd packages/apigateway && go fmt ./...

go-build:
	cd packages/dispatcher && go build -v .

# Web/React commands
web-test:
	@echo "🧪 Running React tests..."
	cd packages/web && npm test -- --coverage

web-test-integration:
	@echo "🧪 Running React integration tests..."
	cd packages/web && npm run test:integration

web-lint:
	@echo "🔍 Running ESLint..."
	cd packages/web && npm run lint

web-lint-fix:
	@echo "🔧 Running ESLint with auto-fix..."
	cd packages/web && npm run lint:fix

web-format:
	@echo "🎨 Formatting code with Prettier..."
	cd packages/web && npm run format

web-format-check:
	@echo "🔍 Checking code formatting..."
	cd packages/web && npm run format:check

web-typecheck:
	@echo "🔍 Running TypeScript type checking..."
	cd packages/web && npm run typecheck

web-build:
	@echo "🔨 Building production bundle..."
	cd packages/web && npm run build

web-dev:
	@echo "⚡ Starting Vite dev server..."
	cd packages/web && npm run dev

# ==========================================
# Protocol Buffer Code Generation
# ==========================================

# Generate protobuf code for all languages
.PHONY: proto-gen
proto-gen: proto-gen-backend proto-gen-web
	@echo "✅ All schemas generated"

# Backend: Use Pants to generate Go & Python code and copy to source tree
# This provides Pants dependency tracking with source tree observability
.PHONY: proto-gen-backend
proto-gen-backend:
	@echo "🔨 Generating Go & Python code with Pants..."
	@command -v pants >/dev/null 2>&1 || { echo "❌ Error: pants not found."; exit 1; }
	pants export-codegen schemas/proto::
	@echo "📋 Syncing generated code to source tree..."
	# Python: Copy sports_metrics and webhook protos to stravapipe (not user_config)
	@mkdir -p packages/stravapipe/src/stravapipe/types/generated
	@find dist/codegen/schemas/proto -name "sports_metrics_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
	@find dist/codegen/schemas/proto -name "webhook_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
	@touch packages/stravapipe/src/stravapipe/types/generated/__init__.py
	# Go: Copy .pb.go files to apigateway and dispatcher
	@mkdir -p packages/apigateway/types/generated packages/dispatcher/types/generated
	@find dist/codegen/schemas/proto \( -name "sports_metrics.pb.go" -o -name "user_config.pb.go" \) -exec cp {} packages/apigateway/types/generated/ \;
	@find dist/codegen/schemas/proto -name "webhook.pb.go" -exec cp {} packages/dispatcher/types/generated/ \;
	# Activities proto goes in subdirectory to match package name
	@mkdir -p packages/apigateway/types/generated/activitiesv1
	@find dist/codegen/schemas/proto -name "activities.pb.go" -exec cp {} packages/apigateway/types/generated/activitiesv1/ \;
	@echo "✅ Backend generation complete"

# Frontend: Use protoc-gen-ts_proto (via npm)
# Web uses sports_metrics and user_config (not webhook - that's backend-only)
# Output is flattened to match existing import paths (e.g., types/generated/user_config)
.PHONY: proto-gen-web
proto-gen-web:
	@echo "🔨 Generating TypeScript code..."
	@command -v protoc >/dev/null 2>&1 || { echo "❌ Error: protoc not found. Install with: brew install protobuf"; exit 1; }
	@test -f packages/web/node_modules/.bin/protoc-gen-ts_proto || { echo "❌ Error: ts-proto not found. Run: cd packages/web && npm install"; exit 1; }
	@mkdir -p packages/web/src/types/generated
	@# Generate to temp directory first (protoc creates nested structure)
	@rm -rf packages/web/src/types/generated/.tmp
	@mkdir -p packages/web/src/types/generated/.tmp
	protoc --plugin=packages/web/node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_out=packages/web/src/types/generated/.tmp \
		--ts_proto_opt=outputJsonMethods=false,outputPartialMethods=false,useOptionals=messages,oneof=unions \
		-I schemas/proto \
		schemas/proto/desirelines/sports/v1/sports_metrics.proto \
		schemas/proto/desirelines/config/v1/user_config.proto \
		schemas/proto/desirelines/activities/v1/activities.proto
	@# Flatten: copy files from nested dirs to root of generated/
	@find packages/web/src/types/generated/.tmp -name "*.ts" -exec cp {} packages/web/src/types/generated/ \;
	@rm -rf packages/web/src/types/generated/.tmp
	@echo "✅ Web generation complete"

# Maintenance
.PHONY: proto-fmt
proto-fmt:
	@echo "🎨 Formatting protobuf files..."
	@command -v buf >/dev/null 2>&1 || { echo "❌ Error: buf not found. Install with: brew install bufbuild/buf/buf"; exit 1; }
	buf format -w schemas/proto
	@echo "✅ Protobuf files formatted"

.PHONY: proto-lint
proto-lint:
	@echo "🔍 Linting protobuf files..."
	@command -v buf >/dev/null 2>&1 || { echo "❌ Error: buf not found. Install with: brew install bufbuild/buf/buf"; exit 1; }
	buf lint schemas/proto
	@echo "✅ Protobuf files linted"

.PHONY: proto-clean
proto-clean:
	@echo "🧹 Cleaning generated code..."
	rm -rf dist/codegen
	rm -f packages/stravapipe/src/stravapipe/types/generated/*_pb2.py*
	rm -f packages/apigateway/types/generated/*.pb.go
	rm -f packages/dispatcher/types/generated/*.pb.go
	rm -f packages/web/src/types/generated/*.ts
	@echo "✅ Generated code cleaned"

# ==========================================
# Schema Sync (Proto + Sport Config)
# ==========================================

# Sync all schemas from schemas/ to packages that need them
# Run after modifying any schema file (proto or sport config)
.PHONY: sync-schemas
sync-schemas: proto-gen-backend sync-sport-config
	@echo "✅ All schemas synced"

.PHONY: sync-sport-config
sync-sport-config:
	@echo "📋 Syncing sport config to packages..."
	@mkdir -p packages/stravapipe/src/stravapipe/config
	@mkdir -p packages/apigateway/config
	@cp schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/
	@cp schemas/sports/sport_types.json packages/apigateway/config/
	@echo "✅ Sport config synced"

.PHONY: verify-schemas
verify-schemas:
	@echo "🔍 Verifying schemas are in sync..."
	@diff -q schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/sport_types.json || \
		(echo "❌ stravapipe sport config out of sync! Run: make sync-schemas" && exit 1)
	@diff -q schemas/sports/sport_types.json packages/apigateway/config/sport_types.json || \
		(echo "❌ apigateway sport config out of sync! Run: make sync-schemas" && exit 1)
	@echo "✅ All schemas in sync"

# ==========================================
# Service Account Management
# ==========================================

# Service Account Management
.PHONY: impersonate-terraform
impersonate-terraform:
	$(call check_project)
	@echo "🔑 Impersonating terraform-desirelines service account..." && \
	gcloud config set auth/impersonate_service_account terraform-desirelines@$(GCP_PROJECT_ID).iam.gserviceaccount.com && \
	echo "✅ Now using terraform-desirelines@$(GCP_PROJECT_ID).iam.gserviceaccount.com"

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

# Terraform formatting and validation
.PHONY: tf-fmt
tf-fmt:
	@echo "🎨 Formatting all Terraform files..."
	@terraform fmt -recursive terraform/

.PHONY: tf-validate-all
tf-validate-all:
	@echo "🔍 Validating all Terraform configurations..."
	@cd terraform/environments/artifacts && terraform init -backend=false && terraform validate
	@cd terraform/environments/dev && terraform init -backend=false && terraform validate
	@cd terraform/environments/prod && terraform init -backend=false && terraform validate
	@cd terraform/modules/desirelines && terraform init -backend=false && terraform validate
	@cd terraform/modules/github-actions-wif && terraform init -backend=false && terraform validate
	@echo "✅ All Terraform configurations are valid!"

# Dev environment operations
.PHONY: tf-dev-init
tf-dev-init:
	@echo "🏗️ Initializing dev Terraform environment..."
	@cd terraform/environments/dev && terraform init

.PHONY: tf-dev-plan
tf-dev-plan:
	@echo "📋 Planning dev Terraform deployment..."
	@cd terraform/environments/dev && terraform plan -var="deployment_version=$$(git rev-parse --short HEAD)"

.PHONY: tf-dev-apply
tf-dev-apply:
	@echo "⚠️  This will apply changes to DEV environment."
	@echo "    Consider using CI/CD for deployments instead."
	@read -p "Type 'dev' to continue: " confirm && [ "$$confirm" = "dev" ] || (echo "Aborted." && exit 1)
	@cd terraform/environments/dev && terraform apply -var="deployment_version=$$(git rev-parse --short HEAD)"

.PHONY: tf-dev-drift
tf-dev-drift:
	@echo "🔍 Checking for drift in dev environment..."
	@cd terraform/environments/dev && \
	terraform plan -detailed-exitcode -var="deployment_version=$$(git rev-parse --short HEAD)" > /dev/null 2>&1; \
	EXIT_CODE=$$?; \
	if [ $$EXIT_CODE -eq 0 ]; then echo "✅ No drift detected"; \
	elif [ $$EXIT_CODE -eq 2 ]; then echo "⚠️  Drift detected! Run 'make tf-dev-plan' to see details."; \
	else echo "❌ Error running plan"; fi

# Prod environment operations
.PHONY: tf-prod-init
tf-prod-init:
	@echo "🏗️ Initializing prod Terraform environment..."
	@cd terraform/environments/prod && terraform init

.PHONY: tf-prod-plan
tf-prod-plan:
	@echo "📋 Planning prod Terraform deployment..."
	@cd terraform/environments/prod && terraform plan -var="deployment_version=$$(git rev-parse --short HEAD)"

.PHONY: tf-prod-apply
tf-prod-apply:
	@echo "🚨 WARNING: This will apply changes to PRODUCTION environment!"
	@echo "    Deployments should go through CI/CD with proper review."
	@read -p "Type 'production' to continue: " confirm && [ "$$confirm" = "production" ] || (echo "Aborted." && exit 1)
	@cd terraform/environments/prod && terraform apply -var="deployment_version=$$(git rev-parse --short HEAD)"

.PHONY: tf-prod-drift
tf-prod-drift:
	@echo "🔍 Checking for drift in prod environment..."
	@cd terraform/environments/prod && \
	terraform plan -detailed-exitcode -var="deployment_version=$$(git rev-parse --short HEAD)" > /dev/null 2>&1; \
	EXIT_CODE=$$?; \
	if [ $$EXIT_CODE -eq 0 ]; then echo "✅ No drift detected"; \
	elif [ $$EXIT_CODE -eq 2 ]; then echo "⚠️  Drift detected! Run 'make tf-prod-plan' to see details."; \
	else echo "❌ Error running plan"; fi

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
	@echo "  tf-fmt                - Format all Terraform files"
	@echo "  tf-validate-all       - Validate all Terraform configurations"
	@echo ""
	@echo "Backend Pipeline (Docker):"
	@echo "  start-backend       - Start backend pipeline (dispatcher, bq-inserter, postgres-writer)"
	@echo "  start-backend-local - Start backend with Terraform-managed GCP resources"
	@echo "  start-backend-debug - Start backend with PubSub UI for debugging (port 4200)"
	@echo "  logs                - View logs from all backend services"
	@echo "  logs-dispatcher     - View dispatcher logs"
	@echo "  logs-bq             - View bq-inserter logs"
	@echo "  logs-postgres       - View postgres-writer logs"
	@echo "  test-full-flow      - Test complete webhook flow"
	@echo ""
	@echo "Frontend Development (Docker):"
	@echo "  start-frontend - Start API Gateway + supporting services"
	@echo "  stop-frontend  - Stop frontend services"
	@echo "  logs-frontend  - View frontend logs (API Gateway + Web UI)"
	@echo "  logs-api       - View API Gateway logs only"
	@echo "  logs-web       - View Web UI logs only"
	@echo ""
	@echo "Database:"
	@echo "  db-connect-local       - Connect to local PostgreSQL database (psql)"
	@echo "  db-migrate-local     - Run database migrations (Flyway)"
	@echo "  db-clean-local       - Clean local database (drops all objects, with confirmation)"
	@echo ""
	@echo "General:"
	@echo "  stop  - Stop all services (backend + frontend)"
	@echo "  build - Build all Docker images"
	@echo "  clean - Clean up Docker resources"
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
	@echo "Protocol Buffers & Schemas:"
	@echo "  proto-gen         - Generate code for all languages (Python + Go + TypeScript)"
	@echo "  proto-gen-backend - Generate Python + Go code via Pants"
	@echo "  proto-gen-web     - Generate TypeScript code via protoc + ts-proto"
	@echo "  proto-fmt         - Format .proto files with buf"
	@echo "  proto-lint        - Lint .proto files with buf"
	@echo "  proto-clean       - Clean generated protobuf code"
	@echo "  sync-schemas      - Regenerate proto code + sync config files to packages"
	@echo "  verify-schemas    - Verify schema files are in sync (runs in CI)"
	@echo ""
	@echo "Build and Publish (Pants):"
	@echo "  build-publish                        - Build and publish all Cloud Run images"
	@echo "  build-publish-tag TAG=abc1234        - Build and publish with specific git SHA"
	@echo ""
	@echo "Secret Management & Webhooks (uses current gcloud project):"
	@echo "  deploy-secrets SECRET_FILE=file.json - Deploy secrets from JSON file with IAM bindings"
	@echo "  create-webhook                - Create webhook subscription"
	@echo "  view-webhook                  - View webhook subscriptions"
	@echo "  delete-webhook                - Delete webhook subscription"
	@echo "  generate-webhook-verify-token - Generate and store secure webhook verify token"
	@echo "  rotate-webhook-verify-token   - Rotate webhook token and update webhook"
	@echo ""
	@echo "GCP Deployment:"
	@echo "  Use Terraform for deployment (see terraform/ directory)"

# Combined commands
test: verify-schemas py-test go-test web-test
lint: py-lint go-lint web-lint proto-lint
format: py-format go-format web-format tf-fmt proto-fmt
typecheck: py-typecheck web-typecheck


# ==========================================
# Docker-based Local Development
# ==========================================

# Start backend pipeline locally with PubSub emulator
start-backend:
	@echo "🚀 Starting backend pipeline locally (PubSub emulator + local storage)..."
	docker compose --profile backend up --build --detach
	@echo "✅ All backend services are running!"
	@echo "📋 Service URLs:"
	@echo "  Dispatcher:       http://localhost:8081"
	@echo "  BQ Inserter:      http://localhost:8083"
	@echo "  PostgreSQL Writer: http://localhost:8086"
	@echo "  PubSub Emulator:  http://localhost:8085"
	@echo ""
	@echo "🧪 Test the full flow:"
	@echo "  make test-full-flow"

# Start backend with local Terraform-managed GCP resources (hybrid mode)
start-backend-local:
	@echo "🚀 Starting backend with local GCP resources (PubSub emulator + Terraform-created BigQuery/Storage)..."
	@if [ ! -f "$$HOME/.config/gcloud/application_default_credentials.json" ]; then \
		echo "❌ Error: No gcloud application default credentials found"; \
		echo "   Please run: gcloud auth application-default login"; \
		echo "   This will authenticate your local environment for GCP access"; \
		exit 1; \
	fi
	docker compose -f docker-compose.yml -f docker-compose.local.yml up --build --detach
	@echo "✅ All backend services are running with local GCP resources!"
	@echo "📋 Service URLs:"
	@echo "  Dispatcher:        http://localhost:8081 (→ PubSub Emulator forwarding)"
	@echo "  BQ Inserter:       http://localhost:8083 (→ Terraform-managed BigQuery)"
	@echo "  PostgreSQL Writer: http://localhost:8086 (→ Terraform-managed Cloud SQL)"
	@echo "  PubSub Emulator:   http://localhost:8085"
	@echo ""
	@echo "🧪 Test the full flow:"
	@echo "  make test-full-flow"
	@echo ""
	@echo "💡 Data will be written to: desirelines.activities (BQ) + PostgreSQL"
	@echo "🔐 Using your gcloud application default credentials"

# Start backend with PubSub UI for debugging
start-backend-debug:
	@echo "🐛 Starting backend pipeline with PubSub debugging UI..."
	docker compose --profile backend --profile debug up --build --detach
	@echo "✅ All backend services are running with debugging UI!"
	@echo "📋 Service URLs:"
	@echo "  Dispatcher:        http://localhost:8081"
	@echo "  BQ Inserter:       http://localhost:8083"
	@echo "  PostgreSQL Writer: http://localhost:8086"
	@echo "  PubSub Emulator:   http://localhost:8085"
	@echo "  🐛 PubSub UI:      http://localhost:4200"
	@echo ""
	@echo "🧪 Test the full flow:"
	@echo "  make test-full-flow"

# View logs from all backend services
logs:
	docker compose --profile backend logs -f

# View dispatcher logs
logs-dispatcher:
	docker compose --profile backend logs -f dispatcher

# View bq-inserter logs
logs-bq:
	docker compose --profile backend logs -f bq-inserter

# View postgres-writer logs
logs-postgres:
	docker compose --profile backend logs -f postgres-writer

# Stop services and cleanup
stop:
	@echo "🛑 Stopping all services..."
	docker compose --profile backend --profile debug --profile frontend down

# Build all images
build:
	@echo "🔨 Building all Docker images..."
	docker compose build

# Test the full end-to-end flow
test-full-flow:
	@echo "🧪 Testing full Strava webhook flow..."
	@echo ""
	@echo "1️⃣ Sending CREATE webhook to dispatcher..."
	@curl -s -X POST http://localhost:8081/webhook \
		-H "Content-Type: application/json" \
		-d '{"aspect_type":"create","event_time":1734200000,"object_id":12345678,"object_type":"activity","owner_id":98765,"subscription_id":123456}' \
		| head -c 200
	@echo ""
	@echo ""
	@echo "2️⃣ Flow: dispatcher → PubSub → CloudEvent adapter → bq-inserter + postgres-writer"
	@echo ""
	@echo "📋 Check logs to verify:"
	@echo "  make logs-dispatcher   # Should show 'Published message'"
	@echo "  make logs-bq           # Should show 'Received CloudEvent' (may fail on Strava API)"
	@echo "  make logs-postgres     # Should show 'Received CloudEvent' (may fail on Strava API)"
	@echo ""
	@echo "💡 Note: Services will try to fetch activity 12345678 from Strava API."
	@echo "   Without valid Strava credentials, you'll see 'activity_not_found' - that's expected."

# Clean up Docker resources
clean:
	@echo "🧹 Cleaning up Docker resources..."
	docker compose down --rmi all --volumes --remove-orphans
	docker system prune -f


# ==========================================
# Build and Publish (Pants)
# ==========================================

# Build and publish all Cloud Run images
.PHONY: build-publish
build-publish:
	@./scripts/operations/build-and-publish.sh

# Build and publish with specific tag
.PHONY: build-publish-tag
build-publish-tag:
	@if [ -z "$(TAG)" ]; then \
		echo "❌ Error: Please specify TAG"; \
		echo "Usage: make build-publish-tag TAG=abc1234"; \
		exit 1; \
	fi
	@./scripts/operations/build-and-publish.sh $(TAG)

# ==========================================
# Secret Management & Webhooks
# ==========================================

deploy-secrets:
	@if [ -z "$(SECRET_FILE)" ]; then \
		echo "❌ Error: Please specify secret file: make deploy-secrets SECRET_FILE=strava-auth.json"; \
		exit 1; \
	fi
	@./scripts/infrastructure/deploy-secrets.sh $(SECRET_FILE)

create-webhook:
	$(call check_project_and_run,./scripts/operations/webhook-management.sh create)

view-webhook:
	$(call check_project_and_run,./scripts/operations/webhook-management.sh view)

delete-webhook:
	@CURRENT_PROJECT="$(GCP_PROJECT_ID)"; \
	if [ "$$CURRENT_PROJECT" = "desirelines-dev" ]; then \
		ENV_NAME="dev"; \
	elif [ "$$CURRENT_PROJECT" = "desirelines-prod" ]; then \
		ENV_NAME="prod"; \
	elif [ "$$CURRENT_PROJECT" = "desirelines-local" ]; then \
		ENV_NAME="local"; \
	else \
		echo "❌ Error: Invalid GCP project for desirelines!"; \
		echo "   Current:  $$CURRENT_PROJECT"; \
		echo "   Expected: desirelines-dev, desirelines-prod, or desirelines-local"; \
		echo "   Fix: gcloud config set project desirelines-dev"; \
		echo "   Or:  gcloud config set project desirelines-prod"; \
		echo "   Or:  gcloud config set project desirelines-local"; \
		exit 1; \
	fi; \
	echo "⚠️  About to delete webhook subscription for $$ENV_NAME environment"; \
	echo "   Project: $$CURRENT_PROJECT"; \
	read -p "Are you sure? (y/N): " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		./scripts/operations/webhook-management.sh delete $$ENV_NAME; \
	else \
		echo "❌ Cancelled webhook deletion"; \
	fi

generate-webhook-verify-token:
	$(call check_project_and_run,./scripts/operations/webhook-management.sh generate-token)

rotate-webhook-verify-token:
	$(call check_project_and_run,./scripts/operations/webhook-management.sh rotate-token)



# ==========================================
# Frontend Development (Web UI + API Gateway)
# ==========================================

# Start frontend development stack (API Gateway + Firebase Emulators + PostgreSQL)
start-frontend:
	@echo "🎨 Starting frontend development stack..."
	docker compose --profile frontend up --build --detach
	@echo "✅ Frontend development stack is running!"
	@echo "📋 Service URLs:"
	@echo "  🔌 API Gateway:         http://localhost:8084"
	@echo "  🔥 Firebase Emulator UI: http://localhost:4000"
	@echo "  🔐 Auth Emulator:        localhost:9099"
	@echo "  📦 Firestore Emulator:   localhost:8089"
	@echo ""
	@echo "💡 To use emulators, add to packages/web/.env.development.local:"
	@echo "   VITE_USE_FIREBASE_EMULATORS=true"
	@echo "   VITE_API_GATEWAY_URL=http://localhost:8084"
	@echo ""
	@echo "   Then run: cd packages/web && npm run dev"

# Stop frontend services
stop-frontend:
	@echo "🛑 Stopping frontend services..."
	docker compose --profile frontend down

# ==========================================
# Database Management
# ==========================================

# Connect to local PostgreSQL database
db-connect-local:
	@echo "🔌 Connecting to local PostgreSQL database..."
	docker compose --profile backend exec postgres psql -U desirelines -d desirelines_local

# Run database migrations
db-migrate-local:
	@echo "🚀 Running database migrations..."
	docker compose build flyway
	docker compose --profile backend run --rm flyway migrate

# Clean local database (drops all objects in desirelines schema)
db-clean-local:
	@echo "🧹 Cleaning local PostgreSQL database..."
	@echo "⚠️  This will drop all objects in the desirelines schema!"
	@read -p "Are you sure? (y/N): " confirm; \
	if [ "$$confirm" = "y" ] || [ "$$confirm" = "Y" ]; then \
		docker compose --profile backend run --rm flyway clean; \
	else \
		echo "❌ Database clean cancelled"; \
	fi

# Production Database Operations
# ==========================================

# Connect to dev database (admin - default)
db-connect-dev:
	@./scripts/database/connect.sh dev --admin

# Connect to prod database (admin - default)
db-connect-prod:
	@./scripts/database/connect.sh prod --admin

# Connect to dev database (apigateway read-only role)
db-connect-dev-ro:
	@./scripts/database/connect.sh dev --apigateway

# Connect to prod database (apigateway read-only role)
db-connect-prod-ro:
	@./scripts/database/connect.sh prod --apigateway

# Run migrations against dev (with dry-run first)
db-migrate-dev:
	@./scripts/database/migrate.sh dev

# Run migrations against dev (dry-run only - shows status)
db-migrate-dev-info:
	@./scripts/database/migrate.sh dev --dry-run

# Run migrations against prod (requires confirmation)
db-migrate-prod:
	@./scripts/database/migrate.sh prod

# Run migrations against prod (dry-run only - shows status)
db-migrate-prod-info:
	@./scripts/database/migrate.sh prod --dry-run

# Clean dev database (drops all objects in desirelines schema)
db-clean-dev:
	@./scripts/database/migrate.sh dev clean
