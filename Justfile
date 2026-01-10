set dotenv-load

# List all available commands
default:
    @just --list

# Alias for 'just --list'
help:
    @just --list

# ==========================================
# Core Developer Workflow
# ==========================================

# Run all tests across Python, Go, and Web
test: py-test go-test web-test

# Run all linters (Ruff, golangci-lint, ESLint, buf)
lint: py-lint go-lint web-lint proto-lint

# Format all code (Ruff, go fmt, Prettier, buf, terraform fmt)
format: py-format go-format web-format proto-fmt tf-fmt

# ==========================================
# Python Commands
# ==========================================

# Run Python tests (default: uv pytest, use --pants for Pants)
py-test +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Running Python tests with Pants..."
        pants test packages/stravapipe::
    else
        echo "🐍 Running Python tests with uv (fast)..."
        cd packages/stravapipe && uv run pytest tests/ {{args}}
    fi

# Run Python linter (default: Ruff fix, use --pants for Pants)
py-lint +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Linting Python with Pants..."
        pants lint packages/stravapipe::
    else
        echo "🐍 Linting Python with Ruff (fast)..."
        cd packages/stravapipe && uv run ruff check . --fix {{args}}
    fi

# Format Python code (default: Ruff format, use --pants for Pants)
py-format +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Formatting Python with Pants..."
        pants fmt packages/stravapipe::
    else
        echo "🐍 Formatting Python with Ruff (fast)..."
        cd packages/stravapipe && uv run ruff format . {{args}}
    fi

# Run Python type checking via Pants/mypy
py-typecheck:
    pants check packages/stravapipe::

# ==========================================
# Go Commands
# ==========================================

# Run Go tests (default: go test, use --pants for Pants)
go-test +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Running Go tests with Pants..."
        pants test packages/dispatcher:: packages/apigateway::
    else
        echo "🐹 Running Go tests with native go (fast)..."
        echo "   Testing dispatcher..."
        cd packages/dispatcher && go test -v ./... {{args}}
        echo "   Testing apigateway..."
        cd packages/apigateway && go test -v ./... {{args}}
    fi

# Run Go linter (default: golangci-lint, use --pants for Pants)
go-lint +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Linting Go with Pants..."
        pants lint packages/dispatcher:: packages/apigateway::
    else
        echo "🐹 Linting Go with golangci-lint (fast)..."
        golangci-lint run ./packages/dispatcher/... ./packages/apigateway/... {{args}}
    fi

# Format Go code (default: go fmt, use --pants for Pants)
go-format +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Formatting Go with Pants..."
        pants fmt packages/dispatcher:: packages/apigateway::
    else
        echo "🐹 Formatting Go with native go fmt (fast)..."
        cd packages/dispatcher && go fmt ./...
        cd packages/apigateway && go fmt ./...
    fi

# ==========================================
# Web/React Commands (npm)
# ==========================================

# Run React unit tests with coverage
web-test:
    cd packages/web && npm test -- --coverage

# Run ESLint on the React project
web-lint:
    cd packages/web && npm run lint

# Format React code with Prettier
web-format:
    cd packages/web && npm run format

# Run TypeScript type checking on the web project
web-typecheck:
    cd packages/web && npm run typecheck

# Start the Vite development server for the web project
web-dev:
    cd packages/web && npm run dev

# Deploy web frontend to Firebase Hosting
deploy-web env:
    @if [ "{{env}}" == "prod" ]; then \
        echo "🚨 WARNING: Deploying to PRODUCTION! 🚨"; \
        read -p "Are you sure? (yes/no): " confirm; \
        if [ "$$confirm" != "yes" ]; then \
            echo "❌ Deployment cancelled"; \
            exit 1; \
        fi; \
    fi
    ./scripts/ops/deploy/deploy-web.sh {{env}}

# ==========================================
# Protocol Buffers
# ==========================================

# Generate all protobuf schemas (Backend + Web)
proto-gen: proto-gen-backend proto-gen-web
    @echo "✅ All schemas generated"

# Generate Python/Go protos via Pants and sync to source tree
proto-gen-backend:
    @echo "🔨 Generating Go & Python code with Pants..."
    pants export-codegen schemas/proto::
    @echo "📋 Syncing generated code to source tree..."
    # Python: Copy sports_metrics and webhook protos to stravapipe
    @mkdir -p packages/stravapipe/src/stravapipe/types/generated
    @find dist/codegen/schemas/proto -name "sports_metrics_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
    @find dist/codegen/schemas/proto -name "webhook_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
    @touch packages/stravapipe/src/stravapipe/types/generated/__init__.py
    # Go: Copy .pb.go files to apigateway and dispatcher
    @mkdir -p packages/apigateway/types/generated packages/dispatcher/types/generated
    @find dist/codegen/schemas/proto \( -name "sports_metrics.pb.go" -o -name "user_config.pb.go" \) -exec cp {} packages/apigateway/types/generated/ \;
    @find dist/codegen/schemas/proto -name "webhook.pb.go" -exec cp {} packages/dispatcher/types/generated/ \;
    @echo "✅ Backend generation complete"

# Generate TypeScript protos via npm/protoc
proto-gen-web:
    @echo "🔨 Generating TypeScript code..."
    @mkdir -p packages/web/src/types/generated
    @# Generate to temp directory first
    @rm -rf packages/web/src/types/generated/.tmp
    @mkdir -p packages/web/src/types/generated/.tmp
    protoc --plugin=packages/web/node_modules/.bin/protoc-gen-ts_proto \
        --ts_proto_out=packages/web/src/types/generated/.tmp \
        --ts_proto_opt=outputJsonMethods=false,outputPartialMethods=false,useOptionals=messages,oneof=unions \
        -I schemas/proto \
        schemas/proto/desirelines/sports/v1/sports_metrics.proto \
        schemas/proto/desirelines/config/v1/user_config.proto
    @# Flatten: copy files from nested dirs to root of generated/
    @find packages/web/src/types/generated/.tmp -name "*.ts" -exec cp {} packages/web/src/types/generated/ \;
    @rm -rf packages/web/src/types/generated/.tmp
    @echo "✅ Web generation complete"

# Regenerate protos and sync JSON configs
sync-schemas: proto-gen-backend sync-sport-config
    @echo "✅ All schemas synced"

# Sync sport_types.json to all backend packages
sync-sport-config:
    @echo "📋 Syncing sport config to packages..."
    @mkdir -p packages/stravapipe/src/stravapipe/config
    @mkdir -p packages/apigateway/config
    @cp schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/
    @cp schemas/sports/sport_types.json packages/apigateway/config/
    @echo "✅ Sport config synced"

# Lint protobuf files using 'buf'
proto-lint:
    @echo "🔍 Linting protobuf files..."
    buf lint schemas/proto

# Format protobuf files using 'buf'
proto-fmt:
    @echo "🎨 Formatting protobuf files..."
    buf format -w schemas/proto

# ==========================================
# Infrastructure (Terraform)
# ==========================================

# Format all Terraform files recursively
tf-fmt:
    @echo "🎨 Formatting all Terraform files..."
    terraform fmt -recursive terraform/
