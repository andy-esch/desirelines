#!/bin/bash
set -e

# Package Cloud Functions source code with SHA-based naming
# Usage: ./scripts/package-functions.sh [SHA]
# If no SHA provided, uses current git HEAD

SHA=${1:-$(git rev-parse --short HEAD)}
DIST_DIR="dist"

echo "🔧 Packaging Cloud Functions source code with SHA: $SHA"

# Create dist directory
mkdir -p "$DIST_DIR"

# Clean up any existing packages for this SHA
rm -f "$DIST_DIR"/*-"$SHA".zip

echo "📦 Creating source packages..."

# =============================================================================
# Go Dispatcher Function
# =============================================================================
echo "  → dispatcher-$SHA.zip"

# Create temporary directory for Go dispatcher
TEMP_GO=$(mktemp -d)
trap "rm -rf $TEMP_GO" EXIT

# 1. Copy function wrapper (as function.go for Cloud Functions)
cp functions/activity_dispatcher/main.go "$TEMP_GO/function.go"

# 2. Copy complete business logic package
mkdir -p "$TEMP_GO/packages"
rsync -av --exclude='__pycache__' --exclude='*.pyc' --exclude='.DS_Store' \
      --exclude='*.egg-info' --exclude='.pytest_cache' --exclude='.git' \
      --exclude='coverage.html' --exclude='coverage.out' \
      --exclude='*_test.go' --exclude='test_*.sh' \
      --exclude='local_dispatcher' --exclude='activity_dispatcher_function' \
      --exclude='Makefile' --exclude='README.md' \
      packages/dispatcher/ "$TEMP_GO/packages/dispatcher/"

# 3. Create go.mod with correct replace directive
cat > "$TEMP_GO/go.mod" << 'EOF'
module github.com/andy-esch/desirelines/dispatcher-function

go 1.25

require (
	cloud.google.com/go/pubsub/v2 v2.0.0
	github.com/GoogleCloudPlatform/functions-framework-go v1.9.2
	github.com/google/uuid v1.6.0
	github.com/andy-esch/desirelines/packages/dispatcher v0.0.0
)

replace github.com/andy-esch/desirelines/packages/dispatcher => ./packages/dispatcher
EOF

# Create the zip from temp directory
cd "$TEMP_GO" && zip -r - . > "$OLDPWD/$DIST_DIR/dispatcher-$SHA.zip"
cd "$OLDPWD"

# =============================================================================
# Python BQ Inserter Function
# =============================================================================
echo "  → bq-inserter-$SHA.zip"

# Create temporary directory for BQ inserter
TEMP_BQ=$(mktemp -d)

# Copy Python function wrapper
cp functions/activity_bq_inserter.py "$TEMP_BQ/main.py"

# Copy stravabqsync business logic
rsync -av --exclude='__pycache__' --exclude='*.pyc' --exclude='.DS_Store' \
      --exclude='*.egg-info' --exclude='.pytest_cache' --exclude='.git' \
      packages/stravabqsync/src/ "$TEMP_BQ/"

# Copy desirelines config (shared dependency)
rsync -av --exclude='__pycache__' --exclude='*.pyc' --exclude='.DS_Store' \
      --exclude='*.egg-info' --exclude='.pytest_cache' --exclude='.git' \
      packages/desirelines/src/desirelines/ "$TEMP_BQ/desirelines/"

# Generate requirements.txt from pyproject.toml for Cloud Functions deployment
cd packages/stravabqsync && uv pip compile pyproject.toml --output-file "$TEMP_BQ/requirements.txt" && cd ../..

# Create the zip
cd "$TEMP_BQ" && zip -r - . > "$OLDPWD/$DIST_DIR/bq-inserter-$SHA.zip"
cd "$OLDPWD"

# =============================================================================
# Python Aggregator Function
# =============================================================================
echo "  → aggregator-$SHA.zip"

# Create temporary directory for aggregator
TEMP_AGG=$(mktemp -d)

# Copy Python function wrapper
cp functions/activity_aggregator.py "$TEMP_AGG/main.py"

# Copy desirelines business logic
rsync -av --exclude='__pycache__' --exclude='*.pyc' --exclude='.DS_Store' \
      --exclude='*.egg-info' --exclude='.pytest_cache' --exclude='.git' \
      packages/desirelines/src/ "$TEMP_AGG/"

# Generate requirements.txt from pyproject.toml for Cloud Functions deployment
cd packages/desirelines && uv pip compile pyproject.toml --output-file "$TEMP_AGG/requirements.txt" && cd ../..

# Create the zip
cd "$TEMP_AGG" && zip -r - . > "$OLDPWD/$DIST_DIR/aggregator-$SHA.zip"
cd "$OLDPWD"

# =============================================================================
# Python API Gateway Function
# =============================================================================
echo "  → api-gateway-$SHA.zip"

# Create temporary directory for API gateway
TEMP_API=$(mktemp -d)

# Copy Python function wrapper
cp functions/api_gateway.py "$TEMP_API/main.py"

# Copy desirelines business logic
rsync -av --exclude='__pycache__' --exclude='*.pyc' --exclude='.DS_Store' \
      --exclude='*.egg-info' --exclude='.pytest_cache' --exclude='.git' \
      packages/desirelines/src/ "$TEMP_API/"

# Generate requirements.txt from pyproject.toml for Cloud Functions deployment
cd packages/desirelines && uv pip compile pyproject.toml --output-file "$TEMP_API/requirements.txt" && cd ../..

# Create the zip
cd "$TEMP_API" && zip -r - . > "$OLDPWD/$DIST_DIR/api-gateway-$SHA.zip"
cd "$OLDPWD"

# =============================================================================
# Create "latest" tagged packages for convenient deployment
# =============================================================================
echo "📦 Creating 'latest' tagged packages..."

# Copy SHA packages to "latest" versions for terraform default support
cp "$DIST_DIR/dispatcher-$SHA.zip" "$DIST_DIR/dispatcher-latest.zip"
cp "$DIST_DIR/bq-inserter-$SHA.zip" "$DIST_DIR/bq-inserter-latest.zip"
cp "$DIST_DIR/aggregator-$SHA.zip" "$DIST_DIR/aggregator-latest.zip"
cp "$DIST_DIR/api-gateway-$SHA.zip" "$DIST_DIR/api-gateway-latest.zip"

# =============================================================================
# Summary
# =============================================================================
echo "✅ Source packages created:"
ls -lh "$DIST_DIR"/*-"$SHA".zip | while read -r line; do
  echo "   $line"
done

echo ""
echo "✅ 'Latest' packages created:"
ls -lh "$DIST_DIR"/*-latest.zip | while read -r line; do
  echo "   $line"
done

echo ""
echo "🚀 Ready for Terraform deployment with:"
echo "   terraform apply                              # Uses 'latest' packages"
echo "   terraform apply -var=\"function_source_tag=$SHA\"  # Uses specific SHA"
