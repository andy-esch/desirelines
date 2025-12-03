.PHONY: help deploy test local lint format typecheck py-test py-lint py-format go-lint go-lint-fix js-lint js-format js-dev start stop logs clean build proto-gen proto-gen-go proto-gen-typescript proto-clean proto-fmt proto-lint copy-sport-config verify-sport-config

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
	uv run pytest packages/stravapipe/tests/

py-test-coverage:
	uv run pytest packages/stravapipe/tests/ --cov=packages/stravapipe/src --cov-report=xml --cov-report=term

py-lint:
	uv run ruff check . --fix

py-format:
	uv run ruff format .

py-typecheck:
	uv run mypy packages/stravapipe/src/

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
	cd packages/dispatcher && golangci-lint run ./...
	cd packages/apigateway && golangci-lint run ./...

go-lint-fix:
	@echo "🔧 Running golangci-lint with auto-fix..."
	cd packages/dispatcher && golangci-lint run --fix ./...
	cd packages/apigateway && golangci-lint run --fix ./...

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
proto-gen: proto-gen-python proto-gen-go proto-gen-typescript
	@echo "✅ Protocol buffer code generation complete"

# Generate protobuf code using Pants (hybrid approach: Pants generates, shell copies to source tree)
# This provides Pants dependency tracking while keeping generated code in source tree for observability
proto-gen-pants:
	@echo "🔨 Generating protobuf code with Pants..."
	@command -v pants >/dev/null 2>&1 || { echo "❌ Error: pants not found. Install with: ./pants --version"; exit 1; }
	pants export-codegen schemas/proto::
	@echo "📋 Copying Python generated code to stravapipe..."
	@mkdir -p packages/stravapipe/src/stravapipe/types/generated
	cp dist/codegen/schemas/proto/activities_pb2.py packages/stravapipe/src/stravapipe/types/generated/
	cp dist/codegen/schemas/proto/activities_pb2.pyi packages/stravapipe/src/stravapipe/types/generated/
	cp dist/codegen/schemas/proto/sports_metrics_pb2.py packages/stravapipe/src/stravapipe/types/generated/
	cp dist/codegen/schemas/proto/sports_metrics_pb2.pyi packages/stravapipe/src/stravapipe/types/generated/
	@# Note: user_config not needed by stravapipe (only apigateway uses it)
	@touch packages/stravapipe/src/stravapipe/types/generated/__init__.py
	@echo "📋 Copying Go generated code to apigateway..."
	@mkdir -p packages/apigateway/types/generated
	cp dist/codegen/schemas/proto/activities.pb.go packages/apigateway/types/generated/
	cp dist/codegen/schemas/proto/sports_metrics.pb.go packages/apigateway/types/generated/
	cp dist/codegen/schemas/proto/user_config.pb.go packages/apigateway/types/generated/
	@echo "✅ Pants-generated code copied to source tree (Python + Go)"
	@echo "ℹ️  TypeScript still uses npm (run 'make proto-gen-typescript' separately if needed)"

# Generate Python code from proto files
# stravapipe only needs: activities.proto, sports_metrics.proto (not user_config)
proto-gen-python:
	@echo "🔨 Generating Python code from proto files..."
	@command -v protoc >/dev/null 2>&1 || { echo "❌ Error: protoc not found. Install with: brew install protobuf"; exit 1; }
	@mkdir -p packages/stravapipe/src/stravapipe/types/generated
	protoc --python_out=packages/stravapipe/src/stravapipe/types/generated \
		--pyi_out=packages/stravapipe/src/stravapipe/types/generated \
		-I schemas/proto \
		schemas/proto/activities.proto \
		schemas/proto/sports_metrics.proto
	@# Create __init__.py to make it a proper Python package
	@touch packages/stravapipe/src/stravapipe/types/generated/__init__.py
	@echo "✅ Python protobuf code generated in packages/stravapipe/src/stravapipe/types/generated/"

# Generate Go code from proto files
# apigateway needs all proto files (serves all data types)
proto-gen-go:
	@echo "🔨 Generating Go code from proto files..."
	@command -v protoc >/dev/null 2>&1 || { echo "❌ Error: protoc not found. Install with: brew install protobuf"; exit 1; }
	@command -v protoc-gen-go >/dev/null 2>&1 || { echo "❌ Error: protoc-gen-go not found. Install with: go install google.golang.org/protobuf/cmd/protoc-gen-go@latest"; exit 1; }
	@mkdir -p packages/apigateway/types/generated
	protoc --go_out=packages/apigateway/types/generated \
		--go_opt=paths=source_relative \
		-I schemas/proto \
		schemas/proto/activities.proto \
		schemas/proto/sports_metrics.proto \
		schemas/proto/user_config.proto
	@echo "✅ Go protobuf code generated in packages/apigateway/types/generated/"

# Generate TypeScript code from proto files
# web needs all proto files (displays all data types)
proto-gen-typescript:
	@echo "🔨 Generating TypeScript code from proto files..."
	@command -v protoc >/dev/null 2>&1 || { echo "❌ Error: protoc not found. Install with: brew install protobuf"; exit 1; }
	@test -f packages/web/node_modules/.bin/protoc-gen-ts_proto || { echo "❌ Error: ts-proto not found. Run: cd packages/web && npm install"; exit 1; }
	@mkdir -p packages/web/src/types/generated
	protoc --plugin=packages/web/node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_out=packages/web/src/types/generated \
		--ts_proto_opt=outputJsonMethods=false,outputPartialMethods=false,useOptionals=messages,oneof=unions \
		-I schemas/proto \
		schemas/proto/activities.proto \
		schemas/proto/sports_metrics.proto \
		schemas/proto/user_config.proto
	@echo "✅ TypeScript protobuf code generated in packages/web/src/types/generated/"

# Clean generated protobuf code
proto-clean:
	@echo "🧹 Cleaning generated protobuf code..."
	rm -rf packages/stravapipe/src/stravapipe/types/generated
	rm -rf packages/apigateway/types/generated
	rm -rf packages/web/src/types/generated
	@echo "✅ Generated protobuf code cleaned"

# Format protobuf files with buf
proto-fmt:
	@echo "🎨 Formatting protobuf files..."
	@command -v buf >/dev/null 2>&1 || { echo "❌ Error: buf not found. Install with: brew install bufbuild/buf/buf"; exit 1; }
	buf format -w schemas/proto
	@echo "✅ Protobuf files formatted"

# Lint protobuf files with buf
proto-lint:
	@echo "🔍 Linting protobuf files..."
	@command -v buf >/dev/null 2>&1 || { echo "❌ Error: buf not found. Install with: brew install bufbuild/buf/buf"; exit 1; }
	buf lint schemas/proto
	@echo "✅ Protobuf files linted"

# ==========================================
# Sport Configuration
# ==========================================

.PHONY: copy-sport-config
copy-sport-config:
	@echo "📋 Copying sport config to packages..."
	@mkdir -p packages/stravapipe/src/stravapipe/config
	@mkdir -p packages/apigateway/config
	@cp schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/
	@cp schemas/sports/sport_types.json packages/apigateway/config/
	@echo "✅ Sport config copied"

.PHONY: verify-sport-config
verify-sport-config:
	@echo "🔍 Verifying sport config..."
	@diff -q schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/sport_types.json || \
		(echo "❌ stravapipe config out of sync! Run: make copy-sport-config" && exit 1)
	@diff -q schemas/sports/sport_types.json packages/apigateway/config/sport_types.json || \
		(echo "❌ apigateway config out of sync! Run: make copy-sport-config" && exit 1)
	@echo "✅ Config copies match source"

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
	@cd terraform/environments/local && terraform init -backend=false && terraform validate
	@cd terraform/environments/dev && terraform init -backend=false && terraform validate
	@cd terraform/environments/prod && terraform init -backend=false && terraform validate
	@cd terraform/modules/desirelines && terraform init -backend=false && terraform validate
	@echo "✅ All Terraform configurations are valid!"

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
	@echo "  start-backend       - Start backend pipeline (dispatcher, aggregator, bq-inserter)"
	@echo "  start-backend-local - Start backend with Terraform-managed GCP resources"
	@echo "  start-backend-debug - Start backend with PubSub UI for debugging (port 4200)"
	@echo "  logs                - View logs from all backend functions"
	@echo "  logs-dispatcher     - View activity-dispatcher logs"
	@echo "  logs-aggregator     - View activity-aggregator logs"
	@echo "  logs-bq             - View activity-bq-inserter logs"
	@echo "  test-full-flow      - Test complete webhook flow"
	@echo ""
	@echo "Frontend Development (Docker):"
	@echo "  start-frontend - Start Web UI + API Gateway with local fixtures"
	@echo "  stop-frontend  - Stop frontend services"
	@echo "  logs-frontend  - View frontend logs (API Gateway + Web UI)"
	@echo "  logs-api       - View API Gateway logs only"
	@echo "  logs-web       - View Web UI logs only"
	@echo "  site-start     - Start Web UI directly (npm, no Docker)"
	@echo "  site-build     - Build Web UI for production"
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
	@echo "Protocol Buffers:"
	@echo "  proto-gen            - Generate code for all languages (Python + Go + TypeScript)"
	@echo "  proto-gen-python     - Generate Python code from .proto files"
	@echo "  proto-gen-go         - Generate Go code from .proto files"
	@echo "  proto-gen-typescript - Generate TypeScript code from .proto files"
	@echo "  proto-fmt            - Format .proto files with buf"
	@echo "  proto-lint           - Lint .proto files with buf"
	@echo "  proto-clean          - Clean generated protobuf code"
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
test: verify-sport-config py-test go-test web-test
lint: py-lint go-lint web-lint proto-lint
format: py-format go-format web-format tf-fmt proto-fmt
typecheck: py-typecheck web-typecheck


# ==========================================
# Docker-based Local Development
# ==========================================

# Start backend pipeline locally with PubSub emulator
start-backend: generate-requirements
	@echo "🚀 Starting backend pipeline locally (PubSub emulator + local storage)..."
	docker compose --profile backend up --build --detach
	@echo "✅ All backend services are running!"
	@echo "📋 Service URLs:"
	@echo "  Dispatcher: http://localhost:8081"
	@echo "  Aggregator: http://localhost:8082"
	@echo "  BQ Inserter: http://localhost:8083"
	@echo "  PubSub Emulator: http://localhost:8085"
	@echo ""
	@echo "🧪 Test the full flow:"
	@echo "  make test-full-flow"

# Start backend with local Terraform-managed GCP resources (hybrid mode)
start-backend-local: generate-requirements
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
	@echo "  Dispatcher: http://localhost:8081 (→ PubSub Emulator forwarding)"
	@echo "  Aggregator: http://localhost:8082 (→ Terraform-managed Cloud Storage)"
	@echo "  BQ Inserter: http://localhost:8083 (→ Terraform-managed BigQuery)"
	@echo "  PubSub Emulator: http://localhost:8085"
	@echo ""
	@echo "🧪 Test the full flow:"
	@echo "  make test-full-flow"
	@echo ""
	@echo "💡 Data will be written to: desirelines.activities"
	@echo "🔐 Using your gcloud application default credentials"

# Start backend with PubSub UI for debugging
start-backend-debug: generate-requirements
	@echo "🐛 Starting backend pipeline with PubSub debugging UI..."
	docker compose --profile backend --profile debug up --build --detach
	@echo "✅ All backend services are running with debugging UI!"
	@echo "📋 Service URLs:"
	@echo "  Dispatcher: http://localhost:8081"
	@echo "  Aggregator: http://localhost:8082"
	@echo "  BQ Inserter: http://localhost:8083"
	@echo "  PubSub Emulator: http://localhost:8085"
	@echo "  🐛 PubSub UI: http://localhost:4200"
	@echo ""
	@echo "🧪 Test the full flow:"
	@echo "  make test-full-flow"

# Stop services and cleanup
stop:
	@echo "🛑 Stopping all services..."
	docker compose --profile backend --profile debug --profile frontend down
	rm -f functions/requirements-*.txt

# Generate function-specific requirements files
generate-requirements:
	@echo "📋 Generating function-specific requirements..."
	@echo "  - Stravapipe package requirements"
	cd packages/stravapipe && uv export --format requirements-txt --no-dev --no-editable > ../../functions/requirements-aggregator.txt
	@echo "  - Removing local package references from aggregator requirements"
	sed -i '' '/^\.\/packages\/stravapipe$$/d' functions/requirements-aggregator.txt
	@echo "  - Stravapipe package requirements (shared for both functions)"
	cd packages/stravapipe && uv export --format requirements-txt --no-dev --no-editable > ../../functions/requirements-stravabqsync.txt
	@echo "  - Removing local package references from BQ inserter requirements"
	sed -i '' '/^\.\/packages\/stravapipe$$/d' functions/requirements-stravabqsync.txt

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
	@if [ -z "$(SECRET_FILE)" ]; then \
		echo "❌ Error: Please specify secret file: make deploy-secrets SECRET_FILE=strava-auth.json"; \
		exit 1; \
	fi
	@./scripts/infrastructure/deploy-secrets.sh $(SECRET_FILE)

create-webhook:
	$(call check_project_and_run,./scripts/webhook-management.sh create)

view-webhook:
	$(call check_project_and_run,./scripts/webhook-management.sh view)

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
		./scripts/webhook-management.sh delete $$ENV_NAME; \
	else \
		echo "❌ Cancelled webhook deletion"; \
	fi

generate-webhook-verify-token:
	$(call check_project_and_run,./scripts/webhook-management.sh generate-token)

rotate-webhook-verify-token:
	$(call check_project_and_run,./scripts/webhook-management.sh rotate-token)



# ==========================================
# Frontend Development (Web UI + API Gateway)
# ==========================================

# Start frontend development stack (API Gateway + Web UI with local fixtures)
start-frontend: generate-requirements
	@echo "🎨 Starting frontend development stack (API Gateway + Web UI with local fixtures)..."
	docker compose --profile frontend up --build --detach
	@echo "✅ Frontend development stack is running!"
	@echo "📋 Service URLs:"
	@echo "  🌐 Web UI: http://localhost:3000"
	@echo "  🔌 API Gateway: http://localhost:8084"
	@echo "  📊 Data Source: Local fixtures (data/fixtures/)"
	@echo ""
	@echo "💡 To use live cloud data instead:"
	@echo "  DATA_SOURCE=cloud-storage make start-frontend"

# Stop frontend services
stop-frontend:
	@echo "🛑 Stopping frontend services..."
	docker compose --profile frontend down

# View frontend logs
logs-frontend:
	docker compose logs -f api-gateway web

logs-api:
	docker compose logs -f api-gateway

logs-web:
	docker compose logs -f web

# Legacy site commands (direct npm, no Docker)
site-start:
	cd web && npm start

site-build:
	cd web && npm run build
