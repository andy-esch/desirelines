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
