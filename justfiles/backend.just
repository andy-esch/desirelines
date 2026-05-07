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

# Run Python type checking (default: mypy, use --pants for Pants)
py-typecheck +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Running Python type checking with Pants..."
        pants check packages/stravapipe::
    else
        echo "🐍 Running Python type checking with mypy (fast)..."
        # --no-warn-unused-configs: the `tests.*` override is intentionally
        # only consumed by `pants check` (which covers tests); this local
        # run scopes to `src/` and would otherwise emit a benign note.
        cd packages/stravapipe && uv run mypy --no-warn-unused-configs src/ {{args}}
    fi

# Run Go tests (default: go test, use --pants for Pants)
go-test +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Running Go tests with Pants..."
        pants test packages/dispatcher:: packages/apigateway::
    else
        echo "🐹 Running Go tests with native go (fast)..."
        echo "   Testing dispatcher..."
        # Execute in a subshell (...) to isolate directory changes
        (cd packages/dispatcher && go test -v ./... {{args}})
        echo "   Testing apigateway..."
        (cd packages/apigateway && go test -v ./... {{args}})
    fi

# Run Go linter (default: golangci-lint, use --pants for Pants)
go-lint +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Linting Go with Pants..."
        pants lint packages/dispatcher:: packages/apigateway:: packages/shared::
    else
        echo "🐹 Linting Go with golangci-lint (fast)..."
        golangci-lint run ./packages/dispatcher/... ./packages/apigateway/... ./packages/shared/... {{args}}
    fi

# Format Go code (default: go fmt, use --pants for Pants)
go-format +args='':
    #!/usr/bin/env bash
    if [[ " {{args}} " == *" --pants "* ]]; then
        echo "👖 Formatting Go with Pants..."
        pants fmt packages/dispatcher:: packages/apigateway::
    else
        echo "🐹 Formatting Go with native go fmt (fast)..."
        # Execute in a subshell (...) to isolate directory changes
        (cd packages/dispatcher && go fmt ./...)
        (cd packages/apigateway && go fmt ./...)
    fi

# Generate the BQ activities .proto file from the BigQuery JSON schema.
# Source of truth: schemas/bigquery/activities_full.json
# Output: schemas/proto/desirelines/bigquery/v1/bq_activities.proto
# Pants picks up the generated .proto via its protobuf_sources target.
# Runs through uv so we use the project's pinned Python version, not
# whatever system `python3` happens to be.
generate-bq-proto:
    @echo "🔨 Generating BQ activities .proto from JSON schema..."
    @uv --directory packages/stravapipe run python ../../schemas/bigquery/generate_proto.py

# Generate Python/Go protos via Pants and sync to source tree
proto-gen-backend: generate-bq-proto
    @echo "🔨 Generating Go & Python code with Pants..."
    pants export-codegen schemas/proto::
    @echo "📋 Syncing generated code to source tree..."
    # Python: Copy sports_metrics, webhook, and BQ activities protos to stravapipe
    @mkdir -p packages/stravapipe/src/stravapipe/types/generated
    @find dist/codegen/schemas/proto -name "sports_metrics_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
    @find dist/codegen/schemas/proto -name "webhook_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
    @find dist/codegen/schemas/proto -name "bq_activities_pb2.py*" -exec cp {} packages/stravapipe/src/stravapipe/types/generated/ \;
    @touch packages/stravapipe/src/stravapipe/types/generated/__init__.py
    # Go: Copy .pb.go files to apigateway and dispatcher
    @mkdir -p packages/apigateway/types/generated packages/dispatcher/types/generated
    @find dist/codegen/schemas/proto \( -name "sports_metrics.pb.go" -o -name "user_config.pb.go" \) -exec cp {} packages/apigateway/types/generated/ \;
    @find dist/codegen/schemas/proto -name "webhook.pb.go" -exec cp {} packages/dispatcher/types/generated/ \;
    @echo "✅ Backend generation complete"

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

# Verify both webhook adapters handle all proto fields and enum values
verify-webhook-adapters:
    @./scripts/verify-webhook-adapters.sh

# Verify schema files are in sync (used in CI)
verify-schemas: verify-webhook-adapters
    @echo "🔍 Verifying schemas are in sync..."
    @diff -q schemas/sports/sport_types.json packages/stravapipe/src/stravapipe/config/sport_types.json || \
        (echo "❌ stravapipe sport config out of sync! Run: just sync-sport-config" && exit 1)
    @diff -q schemas/sports/sport_types.json packages/apigateway/config/sport_types.json || \
        (echo "❌ apigateway sport config out of sync! Run: just sync-sport-config" && exit 1)
    @echo "🔍 Verifying BQ proto matches BQ JSON schema..."
    @uv --directory packages/stravapipe run python ../../schemas/bigquery/generate_proto.py --check
    @echo "✅ All schemas in sync"

# Lint protobuf files using 'buf'
proto-lint:
    @echo "🔍 Linting protobuf files..."
    buf lint schemas/proto

# Check protobuf files for breaking changes against main
proto-breaking:
    @echo "🔍 Checking for breaking protobuf changes..."
    buf breaking schemas/proto --against '.git#branch=main,subdir=schemas/proto'

# Format protobuf files using 'buf'
proto-fmt:
    @echo "🎨 Formatting protobuf files..."
    buf format -w schemas/proto
