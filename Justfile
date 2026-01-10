set dotenv-load

# List available commands
default:
    @just --list

# ==========================================
# Core Developer Workflow
# ==========================================

# Run all tests
test: py-test go-test web-test

# Run all linters
lint: py-lint go-lint web-lint

# Format all code
format: py-format go-format web-format

# ==========================================
# Python Commands (Pants)
# ==========================================

py-test:
    pants test packages/stravapipe::

py-lint:
    pants lint packages/stravapipe::

py-format:
    pants fmt packages/stravapipe::

py-typecheck:
    pants check packages/stravapipe::

# ==========================================
# Go Commands (Pants)
# ==========================================

go-test:
    pants test packages/dispatcher:: packages/apigateway::

go-lint:
    pants lint packages/dispatcher:: packages/apigateway::

go-format:
    pants fmt packages/dispatcher:: packages/apigateway::

# ==========================================
# Web/React Commands (npm)
# ==========================================

web-test:
    cd packages/web && npm test -- --coverage

web-lint:
    cd packages/web && npm run lint

web-format:
    cd packages/web && npm run format

web-typecheck:
    cd packages/web && npm run typecheck

# Start web development server
web-dev:
    cd packages/web && npm run dev

# ==========================================
# Protocol Buffers
# ==========================================

# Generate protobuf code for all languages
proto-gen: proto-gen-backend proto-gen-web
    @echo "✅ All schemas generated"

# Generate Backend Protos (Python + Go) via Pants
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

# Generate Web Protos (TypeScript) via npm/protoc
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

# Sync all schemas (Proto + Sport Config)
sync-schemas: proto-gen-backend sync-sport-config
    @echo "✅ All schemas synced"

# Sync sport config JSON to packages
sync-sport-config:
    @echo "📋 Syncing sport config to packages..."
    @mkdir -p packages/stravapipe/src/stravapipe/config
    @mkdir -p packages/apigateway/config
    @cp schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/
    @cp schemas/sports/sport_types.json packages/apigateway/config/
    @echo "✅ Sport config synced"