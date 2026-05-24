#!/usr/bin/env bash
# Verify that both Go and Python webhook adapters handle all proto fields and enum values.
# Run via: just verify-webhook-adapters
#
# NOTE: `-e` is intentionally omitted. This script uses an `errors` counter and
# expects `grep` to return non-zero when a field/enum is missing — that is the
# signal the loop is testing for. Enabling `-e` would abort on the first miss
# and defeat the purpose. Each external call has an explicit exit path.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PROTO_FILE="$REPO_ROOT/schemas/proto/desirelines/webhook/v1/webhook.proto"
GO_ADAPTER="$REPO_ROOT/packages/dispatcher/adapters/proto/webhook_adapter.go"
PY_ADAPTER="$REPO_ROOT/packages/stravapipe/src/stravapipe/adapters/proto/webhook_adapter.py"

# Verify all required files exist
for f in "$PROTO_FILE" "$GO_ADAPTER" "$PY_ADAPTER"; do
    if [[ ! -f "$f" ]]; then
        echo "ERROR: Required file not found: $f"
        exit 1
    fi
done

errors=0

echo "Checking webhook adapter field coverage..."

# Extract message field names from proto (e.g., "object_id", "title", "updates")
# Matches lines like: "  int64 object_id = 3;" or "  optional string title = 1;"
# Uses awk to grab the word just before "= N"
proto_fields=$(grep -E '^[[:space:]]+(optional[[:space:]]+)?[[:alnum:]_]+[[:space:]]+[[:alnum:]_]+[[:space:]]*=[[:space:]]*[0-9]+' "$PROTO_FILE" \
    | grep -v 'hub_' \
    | awk -F'=' '{print $1}' \
    | awk '{print $NF}' || true)

if [[ -z "$proto_fields" ]]; then
    echo "ERROR: Failed to extract any fields from $PROTO_FILE"
    exit 1
fi

echo "  Extracted fields: $(echo "$proto_fields" | tr '\n' ' ')"

for field in $proto_fields; do
    # Skip raw_activity and event (EnrichedEvent-only fields)
    if [[ "$field" == "raw_activity" || "$field" == "event" ]]; then
        continue
    fi

    if ! grep -q "$field" "$GO_ADAPTER"; then
        echo "  MISSING in Go adapter: $field"
        errors=$((errors + 1))
    fi

    if ! grep -q "$field" "$PY_ADAPTER"; then
        echo "  MISSING in Python adapter: $field"
        errors=$((errors + 1))
    fi
done

# Extract enum values (e.g., ASPECT_TYPE_CREATE, OBJECT_TYPE_ACTIVITY)
# Skip UNSPECIFIED values since adapters handle those as default/error cases
enum_values=$(grep -E '^[[:space:]]+[A-Z_]+[[:space:]]*=[[:space:]]*[0-9]+' "$PROTO_FILE" \
    | awk '{print $1}' \
    | grep -v 'UNSPECIFIED' || true)

if [[ -z "$enum_values" ]]; then
    echo "ERROR: Failed to extract any enum values from $PROTO_FILE"
    exit 1
fi

echo "  Extracted enums: $(echo "$enum_values" | tr '\n' ' ')"

for value in $enum_values; do
    # Extract the lowercase last segment: ASPECT_TYPE_CREATE -> create
    strava_string=$(echo "$value" | sed -E 's/^(ASPECT_TYPE_|OBJECT_TYPE_)//' | tr '[:upper:]' '[:lower:]')

    if ! grep -q "\"$strava_string\"" "$GO_ADAPTER"; then
        echo "  MISSING enum mapping in Go adapter: $value (\"$strava_string\")"
        errors=$((errors + 1))
    fi

    if ! grep -q "\"$strava_string\"" "$PY_ADAPTER"; then
        echo "  MISSING enum mapping in Python adapter: $value (\"$strava_string\")"
        errors=$((errors + 1))
    fi
done

if [[ $errors -gt 0 ]]; then
    echo ""
    echo "Found $errors missing field/enum mappings."
    echo "Update both adapters to handle all proto fields, then re-run: just verify-schemas"
    exit 1
fi

echo "  All proto fields and enums covered by both adapters."
