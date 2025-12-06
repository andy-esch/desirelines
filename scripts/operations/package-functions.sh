#!/bin/bash
set -e

# Package Cloud Functions source code with SHA-based naming
# Usage: ./scripts/operations/package-functions.sh [SHA]
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
# Python BQ Inserter Function
# =============================================================================
echo "  → bq-inserter-$SHA.zip"

# Create temporary directory for BQ inserter
TEMP_BQ=$(mktemp -d)

# Copy Python function wrapper
cp functions/bq_inserter.py "$TEMP_BQ/main.py"

# Copy stravapipe business logic (includes cfutils)
rsync -av --exclude-from='.gitignore' --exclude='.git' \
      packages/stravapipe/src/ "$TEMP_BQ/"

# Generate requirements.txt from stravapipe
cd packages/stravapipe && uv pip compile pyproject.toml --output-file "$TEMP_BQ/requirements.txt" && cd ../..

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
cp functions/aggregator.py "$TEMP_AGG/main.py"

# Copy stravapipe business logic (includes cfutils)
rsync -av --exclude-from='.gitignore' --exclude='.git' \
      packages/stravapipe/src/ "$TEMP_AGG/"

# Generate requirements.txt from stravapipe
cd packages/stravapipe && uv pip compile pyproject.toml --output-file "$TEMP_AGG/requirements.txt" && cd ../..

# Create the zip
cd "$TEMP_AGG" && zip -r - . > "$OLDPWD/$DIST_DIR/aggregator-$SHA.zip"
cd "$OLDPWD"

# =============================================================================
# Create "latest" tagged packages for convenient deployment
# =============================================================================
echo "📦 Creating 'latest' tagged packages..."

# Copy SHA packages to "latest" versions for terraform default support
cp "$DIST_DIR/bq-inserter-$SHA.zip" "$DIST_DIR/bq-inserter-latest.zip"
cp "$DIST_DIR/aggregator-$SHA.zip" "$DIST_DIR/aggregator-latest.zip"

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
