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
# [MIGRATED] Replaced by 'just py-test'
py-test:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just py-test'"
	cd packages/stravapipe && uv run pytest tests/

py-test-coverage:
	@echo "⚠️  [DEPRECATED] Use 'just py-test --cov=src --cov-report=xml --cov-report=term'"
	cd packages/stravapipe && uv run pytest tests/ --cov=src --cov-report=xml --cov-report=term

# [MIGRATED] Replaced by 'just py-lint'
py-lint:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just py-lint'"
	cd packages/stravapipe && uv run ruff check . --fix

# [MIGRATED] Replaced by 'just py-format'
py-format:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just py-format'"
	cd packages/stravapipe && uv run ruff format .

# [MIGRATED] Replaced by 'just py-typecheck'
py-typecheck:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just py-typecheck'"
	cd packages/stravapipe && uv run mypy src/

# Go commands
# [MIGRATED] Replaced by 'just go-test'
go-test:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just go-test'"
	@echo "🧪 Running Go tests for local packages..."
	cd packages/dispatcher && go test -v ./...
	cd packages/apigateway && go test -v ./...

go-test-all:
	@echo "⚠️  [DEPRECATED] Use 'just go-test' (it runs all tests in the package)"
	@echo "🧪 Running all Go tests in workspace (parallelism=2)..."
	go test -v -p 2 all

go-test-coverage:
	@echo "⚠️  [DEPRECATED] Use 'just go-test -coverprofile=coverage.out'"
	@echo "🧪 Running Go tests with coverage..."
	cd packages/dispatcher && go test -v -coverprofile=coverage.out -covermode=atomic ./...
	cd packages/apigateway && go test -v -coverprofile=coverage.out -covermode=atomic ./...

# [MIGRATED] Replaced by 'just go-lint'
go-lint:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just go-lint'"
	@echo "🔍 Running golangci-lint..."
	golangci-lint run ./packages/dispatcher/... ./packages/apigateway/...

go-lint-fix:
	@echo "⚠️  [DEPRECATED] Use 'just go-lint --fix'"
	@echo "🔧 Running golangci-lint with auto-fix..."
	golangci-lint run --fix ./packages/dispatcher/... ./packages/apigateway/...

# [MIGRATED] Replaced by 'just go-format'
go-format:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just go-format'"
	cd packages/dispatcher && go fmt ./...
	cd packages/apigateway && go fmt ./...

go-build:
	@echo "⚠️  [DEPRECATED] Use direct 'go build' or rely on pants"
	cd packages/dispatcher && go build -v .

# Web/React commands
# [MIGRATED] Replaced by 'just web-test'
web-test:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just web-test'"
	@echo "🧪 Running React tests..."
	cd packages/web && npm test -- --coverage

web-test-integration:
	@echo "⚠️  [DEPRECATED] Use 'cd packages/web && npm run test:integration'"
	@echo "🧪 Running React integration tests..."
	cd packages/web && npm run test:integration

# [MIGRATED] Replaced by 'just web-lint'
web-lint:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just web-lint'"
	@echo "🔍 Running ESLint..."
	cd packages/web && npm run lint

web-lint-fix:
	@echo "⚠️  [DEPRECATED] Use 'cd packages/web && npm run lint:fix'"
	@echo "🔧 Running ESLint with auto-fix..."
	cd packages/web && npm run lint:fix

# [MIGRATED] Replaced by 'just web-format'
web-format:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just web-format'"
	@echo "🎨 Formatting code with Prettier..."
	cd packages/web && npm run format

web-format-check:
	@echo "⚠️  [DEPRECATED] Use 'cd packages/web && npm run format:check'"
	@echo "🔍 Checking code formatting..."
	cd packages/web && npm run format:check

# [MIGRATED] Replaced by 'just web-typecheck'
web-typecheck:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just web-typecheck'"
	@echo "🔍 Running TypeScript type checking..."
	cd packages/web && npm run typecheck

web-build:
	@echo "⚠️  [DEPRECATED] Use 'cd packages/web && npm run build' or 'just build-publish'"
	@echo "🔨 Building production bundle..."
	cd packages/web && npm run build

# [MIGRATED] Replaced by 'just web-dev'
web-dev:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just web-dev'"
	@echo "⚡ Starting Vite dev server..."
	cd packages/web && npm run dev

# ========================================== 
# Protocol Buffer Code Generation
# ========================================== 

# Generate protobuf code for all languages
.PHONY: proto-gen
# [MIGRATED] Replaced by 'just proto-gen'
proto-gen:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just proto-gen'"
	proto-gen-backend proto-gen-web
	@echo "✅ All schemas generated"

# Backend: Use Pants to generate Go & Python code and copy to source tree
# This provides Pants dependency tracking with source tree observability
.PHONY: proto-gen-backend
# [MIGRATED] Replaced by 'just proto-gen-backend'
proto-gen-backend:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just proto-gen-backend'"
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
# [MIGRATED] Replaced by 'just proto-gen-web'
proto-gen-web:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just proto-gen-web'"
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
# [MIGRATED] Replaced by 'just proto-fmt'
proto-fmt:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just proto-fmt'"
	@echo "🎨 Formatting protobuf files..."
	@command -v buf >/dev/null 2>&1 || { echo "❌ Error: buf not found. Install with: brew install bufbuild/buf/buf"; exit 1; }
	buf format -w schemas/proto
	@echo "✅ Protobuf files formatted"

.PHONY: proto-lint
# [MIGRATED] Replaced by 'just proto-lint'
proto-lint:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just proto-lint'"
	@echo "🔍 Linting protobuf files..."
	@command -v buf >/dev/null 2>&1 || { echo "❌ Error: buf not found. Install with: brew install bufbuild/buf/buf"; exit 1; }
	buf lint schemas/proto
	@echo "✅ Protobuf files linted"

.PHONY: proto-clean
proto-clean:
	@echo "⚠️  [DEPRECATED] No direct just equivalent yet. Manually clean if needed."
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
# [MIGRATED] Replaced by 'just sync-schemas'
sync-schemas:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just sync-schemas'"
	proto-gen-backend sync-sport-config
	@echo "✅ All schemas synced"

.PHONY: sync-sport-config
# [MIGRATED] Replaced by 'just sync-sport-config'
sync-sport-config:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just sync-sport-config'"
	@echo "📋 Syncing sport config to packages..."
	@mkdir -p packages/stravapipe/src/stravapipe/config
	@mkdir -p packages/apigateway/config
	@cp schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/
	@cp schemas/sports/sport_types.json packages/apigateway/config/
	@echo "✅ Sport config synced"

.PHONY: verify-schemas
verify-schemas:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just verify-schemas'"
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
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just auth-impersonate'"
	$(call check_project)
	@echo "🔑 Impersonating terraform-desirelines service account..." && \
	gcloud config set auth/impersonate_service_account terraform-desirelines@$(GCP_PROJECT_ID).iam.gserviceaccount.com && \
	echo "✅ Now using terraform-desirelines@$(GCP_PROJECT_ID).iam.gserviceaccount.com"

.PHONY: stop-impersonate
stop-impersonate:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just auth-stop'"
	@echo "🔑 Stopping service account impersonation..."
	@gcloud config unset auth/impersonate_service_account
	@echo "✅ Now using your user account"

.PHONY: check-auth
check-auth:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just auth-status'"
	@echo "🔍 Current authentication status:"
	@echo "Active account: $$(gcloud config get-value account)"
	@echo "Impersonating: $$(gcloud config get-value auth/impersonate_service_account || echo 'None')"

# ========================================== 
# Terraform Operations
# ========================================== 

.PHONY: tf-local-init
tf-local-init:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-init local'"
	@echo "🏗️ Initializing local Terraform environment..."
	@cd terraform/environments/local && terraform init

.PHONY: tf-local-plan
tf-local-plan:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-plan local'"
	@echo "📋 Planning local Terraform deployment..."
	@cd terraform/environments/local && terraform plan

.PHONY: tf-local-apply
tf-local-apply:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-apply local'"
	@echo "🚀 Applying local Terraform deployment..."
	@cd terraform/environments/local && terraform apply

.PHONY: tf-local-destroy
tf-local-destroy:
	@echo "⚠️  [DEPRECATED] Use 'just tf local destroy'"
	@echo "💥 Destroying local Terraform resources..."
	@cd terraform/environments/local && terraform destroy

# Terraform formatting and validation
.PHONY: tf-fmt
# [MIGRATED] Replaced by 'just tf-fmt'
tf-fmt:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-fmt'"
	@echo "🎨 Formatting all Terraform files..."
	@terraform fmt -recursive terraform/

.PHONY: tf-validate-all
tf-validate-all:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-validate-all'"
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
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-init dev'"
	@echo "🏗️ Initializing dev Terraform environment..."
	@cd terraform/environments/dev && terraform init

.PHONY: tf-dev-plan
tf-dev-plan:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-plan dev'"
	@echo "📋 Planning dev Terraform deployment..."
	@cd terraform/environments/dev && terraform plan -var="deployment_version=$$(git rev-parse --short HEAD)"

.PHONY: tf-dev-apply
tf-dev-apply:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-apply dev'"
	@echo "⚠️  This will apply changes to DEV environment."
	@echo "    Consider using CI/CD for deployments instead."
	@read -p "Type 'dev' to continue: " confirm && [ "$$confirm" = "dev" ] || (echo "Aborted." && exit 1)
	@cd terraform/environments/dev && terraform apply -var="deployment_version=$$(git rev-parse --short HEAD)"

.PHONY: tf-dev-drift
tf-dev-drift:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-drift dev'"
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
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-init prod'"
	@echo "🏗️ Initializing prod Terraform environment..."
	@cd terraform/environments/prod && terraform init

.PHONY: tf-prod-plan
tf-prod-plan:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-plan prod'"
	@echo "📋 Planning prod Terraform deployment..."
	@cd terraform/environments/prod && terraform plan -var="deployment_version=$$(git rev-parse --short HEAD)"

.PHONY: tf-prod-apply
tf-prod-apply:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-apply prod'"
	@echo "🚨 WARNING: This will apply changes to PRODUCTION environment!"
	@echo "    Deployments should go through CI/CD with proper review."
	@read -p "Type 'production' to continue: " confirm && [ "$$confirm" = "production" ] || (echo "Aborted." && exit 1)
	@cd terraform/environments/prod && terraform apply -var="deployment_version=$$(git rev-parse --short HEAD)"

.PHONY: tf-prod-drift
tf-prod-drift:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just tf-drift prod'"
	@echo "🔍 Checking for drift in prod environment..."
	@cd terraform/environments/prod && \
	terraform plan -detailed-exitcode -var="deployment_version=$$(git rev-parse --short HEAD)" > /dev/null 2>&1; \
	EXIT_CODE=$$?; \
	if [ $$EXIT_CODE -eq 0 ]; then echo "✅ No drift detected"; \
	elif [ $$EXIT_CODE -eq 2 ]; then echo "⚠️  Drift detected! Run 'make tf-prod-plan' to see details."; \
	else echo "❌ Error running plan"; fi

# Combined workflows
.PHONY: setup-local
setup-local:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just setup-local'"
	impersonate-terraform tf-local-init tf-local-plan
	@echo "✅ Local environment ready! Run 'make tf-local-apply' to create resources."

# Help target
help:
	@echo "⚠️  The Makefile is deprecated. Please use 'just' for all commands."
	@echo "   Run 'just --list' (or 'just help') to see available recipes."

# (Legacy help text removed to avoid confusion)

# Combined commands
# [MIGRATED] Replaced by 'just test'
test:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just test'"
	verify-schemas py-test go-test web-test
# [MIGRATED] Replaced by 'just lint'
lint:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just lint'"
	py-lint go-lint web-lint proto-lint
# [MIGRATED] Replaced by 'just format'
format:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just format'"
	py-format go-format web-format tf-fmt proto-fmt
# [MIGRATED] Replaced by 'just typecheck'
typecheck:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just typecheck'"
	py-typecheck web-typecheck

# ========================================== 
# Docker-based Local Development
# ========================================== 

# Start backend pipeline locally with PubSub emulator
start-backend:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just start'"
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

# Start backend with PubSub UI for debugging
start-backend-debug:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just start mode=debug'"
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
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just logs'"
	docker compose --profile backend logs -f

# View dispatcher logs
logs-dispatcher:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just logs dispatcher'"
	docker compose --profile backend logs -f dispatcher

# View bq-inserter logs
logs-bq:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just logs bq-inserter'"
	docker compose --profile backend logs -f bq-inserter

# View postgres-writer logs
logs-postgres:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just logs postgres-writer'"
	docker compose --profile backend logs -f postgres-writer

# Stop services and cleanup
stop:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just stop'"
	@echo "🛑 Stopping all services..."
	docker compose --profile backend --profile debug --profile frontend down

# Build all images
build:
	@echo "⚠️  [DEPRECATED] No direct just equivalent. Use docker compose build."
	@echo "🔨 Building all Docker images..."
	docker compose build

# Test the full end-to-end flow
test-full-flow:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just test-flow'"
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
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just clean'"
	@echo "🧹 Cleaning up Docker resources..."
	docker compose down --rmi all --volumes --remove-orphans
	docker system prune -f


# ========================================== 
# Build and Publish (Pants)
# ========================================== 

# Build and publish all Cloud Run images
.PHONY: build-publish
build-publish:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just build-publish'"
	@./scripts/ops/deploy/build-and-publish.sh

# Build and publish with specific tag
.PHONY: build-publish-tag
build-publish-tag:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just build-publish tag=...'"
	@if [ -z "$(TAG)" ]; then \
		echo "❌ Error: Please specify TAG"; \
		echo "Usage: make build-publish-tag TAG=abc1234"; \
		exit 1; \
	fi
	@./scripts/ops/deploy/build-and-publish.sh $(TAG)

# ========================================== 
# Secret Management & Webhooks
# ========================================== 

deploy-secrets:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just secret-deploy'"
	@if [ -z "$(SECRET_FILE)" ]; then \
		echo "❌ Error: Please specify secret file: make deploy-secrets SECRET_FILE=strava-auth.json"; \
		exit 1; \
	fi
	@./scripts/ops/deploy/deploy-secrets.sh $(SECRET_FILE)

create-webhook:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just webhook create ...'"
	$(call check_project_and_run,./scripts/ops/webhook-management.sh create)

view-webhook:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just webhook view ...'"
	$(call check_project_and_run,./scripts/ops/webhook-management.sh view)

delete-webhook:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just webhook delete ...'"
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
		./scripts/ops/webhook-management.sh delete $$ENV_NAME; \
	else \
		echo "❌ Cancelled webhook deletion"; \
	fi

generate-webhook-verify-token:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just webhook generate-token ...'"
	$(call check_project_and_run,./scripts/ops/webhook-management.sh generate-token)

rotate-webhook-verify-token:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just webhook rotate-token ...'"
	$(call check_project_and_run,./scripts/ops/webhook-management.sh rotate-token)



# ========================================== 
# Frontend Development (Web UI + API Gateway)
# ========================================== 

# Start frontend development stack (API Gateway + Firebase Emulators + PostgreSQL)
start-frontend:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just start-frontend'"
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
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just stop'"
	@echo "🛑 Stopping frontend services..."
	docker compose --profile frontend down

# ========================================== 
# Database Management
# ========================================== 

# Connect to local PostgreSQL database
db-connect-local:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-connect-local'"
	@echo "🔌 Connecting to local PostgreSQL database..."
	docker compose --profile backend exec postgres psql -U desirelines -d desirelines_local

# Run database migrations
db-migrate-local:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-migrate-local'"
	@echo "🚀 Running database migrations..."
	docker compose build flyway
	docker compose --profile backend run --rm flyway migrate

# Clean local database (drops all objects in desirelines schema)
db-clean-local:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-clean-local'"
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
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-connect dev'"
	@./scripts/database/connect.sh dev --admin

# Connect to prod database (admin - default)
db-connect-prod:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-connect prod'"
	@./scripts/database/connect.sh prod --admin

# Connect to dev database (apigateway read-only role)
db-connect-dev-ro:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-connect dev apigateway'"
	@./scripts/database/connect.sh dev --apigateway

# Connect to prod database (apigateway read-only role)
db-connect-prod-ro:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-connect prod apigateway'"
	@./scripts/database/connect.sh prod --apigateway

# Run migrations against dev (with dry-run first)
db-migrate-dev:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-migrate dev'"
	@./scripts/database/migrate.sh dev

# Run migrations against dev (dry-run only - shows status)
db-migrate-dev-info:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-migrate dev info'"
	@./scripts/database/migrate.sh dev --dry-run

# Run migrations against prod (requires confirmation)
db-migrate-prod:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-migrate prod'"
	@./scripts/database/migrate.sh prod

# Run migrations against prod (dry-run only - shows status)
db-migrate-prod-info:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-migrate prod info'"
	@./scripts/database/migrate.sh prod --dry-run

# Clean dev database (drops all objects in desirelines schema)
db-clean-dev:
	@echo "⚠️  [DEPRECATED] This command is migrated to 'just db-clean dev'"
	@./scripts/database/migrate.sh dev clean
