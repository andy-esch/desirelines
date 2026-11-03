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

# Fail on unused files, exports, types and dependencies in the web project (knip.json)
web-knip:
    cd packages/web && npm run knip

# Start the Vite development server for the web project
web-dev:
    cd packages/web && npm run dev

# Build the web project into packages/web/build (mode: staging, production, development)
web-build mode="staging":
    cd packages/web && npm run build -- --mode {{mode}}

# Serve the last web build locally, for checking the bundle the browser actually gets.
# The mode must match the one `web-build` used, or Vite re-validates against the wrong env.
web-preview port="4173" mode="staging":
    cd packages/web && npm run preview -- --port {{port}} --mode {{mode}}

# Deploy web frontend to Firebase Hosting
deploy-web env:
    #!/usr/bin/env bash
    if [ "{{env}}" == "prod" ]; then
        echo "🚨 WARNING: Deploying to PRODUCTION! 🚨"
        read -p "Are you sure? (yes/no): " confirm < /dev/tty
        if [ "$confirm" != "yes" ]; then
            echo "❌ Deployment cancelled"
            exit 1
        fi
    fi
    ./scripts/ops/deploy/deploy-web.sh {{env}}

# The protoc that made the committed TypeScript in packages/web/src/types/generated. With
# ts-proto, pinned exactly in packages/web/package.json, it makes regeneration on an unchanged
# proto a no-op. CI installs this version. To bump either, see "Generated protobuf code" in
# docs/guides/ci.md.
protoc_version := "35.0"

# Generate TypeScript protos via npm/protoc
proto-gen-web:
    @found="$(protoc --version 2>/dev/null || echo 'no protoc')"; \
    if [ "$found" != "libprotoc {{protoc_version}}" ]; then \
        echo "❌ proto-gen-web needs protoc {{protoc_version}}, the version the committed code was made with (found: $found)."; \
        echo "   Install it from https://github.com/protocolbuffers/protobuf/releases/tag/v{{protoc_version}}"; \
        exit 1; \
    fi
    @echo "🔨 Generating TypeScript code..."
    @mkdir -p packages/web/src/types/generated
    @# Generate to temp directory first
    @rm -rf packages/web/src/types/generated/.tmp
    @mkdir -p packages/web/src/types/generated/.tmp
    @# sports_metrics + user_config: forceLong=number. Their only int64 field
    @# (sports_metrics activity_ids) is an internal, display-filtered metric that's
    @# never compared numerically or sent across the map cross-filter, so it stays a
    @# number to avoid churn across the dashboard/chart consumers. NOTE: ts-proto's
    @# *default* (no forceLong) is `string`, so this flag is required to keep number.
    protoc --plugin=packages/web/node_modules/.bin/protoc-gen-ts_proto \
        --ts_proto_out=packages/web/src/types/generated/.tmp \
        --ts_proto_opt=outputJsonMethods=false,outputPartialMethods=false,useOptionals=messages,oneof=unions,forceLong=number \
        -I schemas/proto \
        schemas/proto/desirelines/sports/v1/sports_metrics.proto \
        schemas/proto/desirelines/config/v1/user_config.proto
    @# activities: forceLong=string. Its int64 ids (activity id, region ids) cross
    @# service boundaries — the map cross-filter matches them against the numeric
    @# activity_id in MVT tiles, and they build app links — and protojson
    @# serializes int64 as a JSON *string*. The generated type MUST say `string` or
    @# the contract silently lies; the API boundary (api/map.ts) coerces to number.
    protoc --plugin=packages/web/node_modules/.bin/protoc-gen-ts_proto \
        --ts_proto_out=packages/web/src/types/generated/.tmp \
        --ts_proto_opt=outputJsonMethods=false,outputPartialMethods=false,useOptionals=messages,oneof=unions,forceLong=string \
        -I schemas/proto \
        schemas/proto/desirelines/activities/v1/activities.proto
    @# Flatten: copy files from nested dirs to root of generated/
    @find packages/web/src/types/generated/.tmp -name "*.ts" -exec cp {} packages/web/src/types/generated/ \;
    @rm -rf packages/web/src/types/generated/.tmp
    @echo "✅ Web generation complete"

# Regenerate the web's protobuf TypeScript and fail if it differs from what's committed (CI runs this)
proto-check-web: proto-gen-web
    @if ! git diff --quiet -- packages/web/src/types/generated || [ -n "$(git ls-files --others --exclude-standard -- packages/web/src/types/generated)" ]; then \
        git --no-pager diff --stat -- packages/web/src/types/generated; \
        git ls-files --others --exclude-standard -- packages/web/src/types/generated; \
        echo "❌ packages/web/src/types/generated is out of date with schemas/proto."; \
        echo "   Run 'just proto-gen-web' (protoc {{protoc_version}}, ts-proto as pinned in packages/web/package.json) and commit the result."; \
        exit 1; \
    fi
    @echo "✅ Generated TypeScript matches schemas/proto"
