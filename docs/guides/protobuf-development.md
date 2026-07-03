# Protobuf Development Guide

How to work with Protocol Buffer schemas in Desirelines.

## Overview

Protobufs define cross-language type contracts shared between:

- **Go** (apigateway, dispatcher)
- **Python** (stravapipe)
- **TypeScript** (web)

```
schemas/proto/
└── desirelines/
    ├── activities/v1/activities.proto   # Activity list/detail API
    ├── config/v1/user_config.proto      # User settings (Firestore)
    ├── sports/v1/sports_metrics.proto   # Activity metrics API
    └── webhook/v1/webhook.proto         # Strava webhook events
```

## Quick Reference

```bash
# Generate AND sync all schemas (recommended)
just sync-schemas

# Generate all languages (proto only, no sport config)
just proto-gen

# Generate backend only (Go + Python)
just proto-gen-backend

# Generate web only (TypeScript)
just proto-gen-web

# Verify schemas are in sync (runs in CI)
just verify-schemas

# Lint schemas
just proto-lint

# Format schemas
just proto-fmt
```

## Schema Sync Workflow

The `schemas/` directory is the **source of truth**. Generated code and config copies live in packages:

```
schemas/
├── proto/                    # Proto definitions (source)
│   └── desirelines/...
└── sports/
    └── sport_types.json      # Sport config (source)

packages/
├── apigateway/
│   ├── config/sport_types.json     # Copy (synced)
│   └── types/generated/*.pb.go     # Generated
├── stravapipe/
│   └── src/stravapipe/
│       ├── config/sport_types.json # Copy (synced)
│       └── types/generated/*_pb2.py # Generated
└── web/
    └── src/types/generated/*.ts     # Generated
```

**After modifying any schema:**

```bash
just sync-schemas   # Regenerates code + copies config
git add schemas/ packages/*/types/generated/ packages/*/config/
```

**CI checks:** The `Schema Sync` job runs `just verify-schemas` to ensure copies are in sync.

## Adding a New Proto File

### 1. Create the Proto File

Proto files live in `schemas/proto/desirelines/<domain>/v1/`:

```bash
mkdir -p schemas/proto/desirelines/activities/v1
```

```protobuf
// schemas/proto/desirelines/activities/v1/activities.proto
syntax = "proto3";

package desirelines.activities.v1;

// Go code generated to apigateway for activity handling
option go_package = "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1";

// Activity represents a single activity with full details.
message Activity {
  int64 id = 1;
  string name = 2;
  string type = 3;                      // Strava activity type
  string sport = 4;                     // Categorized sport
  string start_date_local = 5;          // ISO 8601 timestamp
  double distance_meters = 6;
  int32 moving_time_seconds = 7;
  int32 elapsed_time_seconds = 8;
  optional double elevation_meters = 9; // Nullable
}

// ActivitySummary for list views (omits detailed stats).
message ActivitySummary {
  int64 id = 1;
  string name = 2;
  string type = 3;
  string sport = 4;
  string start_date_local = 5;
  double distance_meters = 6;
  int32 moving_time_seconds = 7;
  optional double elevation_meters = 8;
}

message ListActivitiesResponse {
  repeated ActivitySummary activities = 1;
  optional string next_cursor = 2;
  bool has_more = 3;
}
```

### 2. Add BUILD Target

Add to `schemas/proto/BUILD`:

```python
# New proto for activities API
protobuf_sources(
    name="activities",
    sources=["desirelines/activities/v1/activities.proto"],
    go_mod_address="packages/apigateway:mod",
    # Add python_resolve if needed by stravapipe:
    # python_resolve="stravapipe",
)
```

### 3. Generate Code

```bash
# Generate for all languages
just proto-gen

# Or just backend (Go + Python)
just proto-gen-backend
```

### 4. Use Generated Types

**Go (apigateway):**

```go
import (
    activitiesv1 "github.com/andy-esch/desirelines/packages/apigateway/types/generated/activitiesv1"
)

func handleActivities(w http.ResponseWriter, r *http.Request) {
    response := &activitiesv1.ListActivitiesResponse{
        Activities: []*activitiesv1.ActivitySummary{
            {Id: 123, Name: "Morning Run", Type: "Run", Sport: "running"},
        },
        HasMore: false,
    }
    respondProtobuf(w, response)  // Uses protojson for camelCase JSON output
}
```

**TypeScript (web):**

```typescript
import type { ActivitySummary, ListActivitiesResponse } from '../types/generated/activities';

const response: ListActivitiesResponse = await api.get('/activities');
response.activities.forEach((a: ActivitySummary) => {
    console.log(a.name, a.distanceMeters, a.startDateLocal);  // camelCase in TS
});
```

**Python (stravapipe):**

`activities.proto` is Go/TS-only — it is **not** generated for Python
(see [Proto Consumers by File](#proto-consumers-by-file) below).
stravapipe consumes the `webhook` and `sports_metrics` protos instead:

```python
from stravapipe.types.generated import webhook_pb2

event = webhook_pb2.WebhookEvent(
    object_id=123,
    owner_id=456,
    subscription_id=1,
    event_time=1719792000,
)
```

## Modifying Existing Protos

### Adding Fields (Non-Breaking)

```protobuf
message Activity {
  int64 id = 1;
  string name = 2;
  // ... existing fields ...

  // NEW: Add new fields with next available number
  string description = 10;
  repeated string tags = 11;
}
```

Then regenerate:

```bash
just proto-gen
git add schemas/proto/ packages/*/types/generated/
git commit -m "feat: add description and tags to Activity proto"
```

### Breaking Changes

Avoid breaking changes when possible. If required:

1. **Create new version:**

   ```bash
   mkdir -p schemas/proto/desirelines/activities/v2
   cp schemas/proto/desirelines/activities/v1/activities.proto \
      schemas/proto/desirelines/activities/v2/activities.proto
   ```

2. **Update package name:**

   ```protobuf
   package desirelines.activities.v2;
   ```

3. **Support both versions** during migration period

4. **Deprecate v1** after consumers migrate

## Generated Code Locations

| Language | Location | Build System |
|----------|----------|--------------|
| Go (apigateway) | `packages/apigateway/types/generated/` | Pants |
| Go (dispatcher) | `packages/dispatcher/types/generated/` | Pants |
| Python | `packages/stravapipe/src/stravapipe/types/generated/` | Pants |
| TypeScript | `packages/web/src/types/generated/` | protoc + ts-proto |

## Build System Details

### Backend (Pants)

Pants generates Go and Python code via `protobuf_sources` targets:

```python
# schemas/proto/BUILD
protobuf_sources(
    name="sports_metrics",
    sources=["desirelines/sports/v1/sports_metrics.proto"],
    python_resolve="stravapipe",           # Generate Python
    go_mod_address="packages/apigateway:mod",  # Generate Go
)
```

Generation happens in `dist/codegen/`, then Justfile copies to package directories.

### Frontend (protoc + ts-proto)

TypeScript uses protoc directly with ts-proto plugin:

```bash
protoc \
  --plugin=protoc-gen-ts_proto=./node_modules/.bin/protoc-gen-ts_proto \
  --ts_proto_out=packages/web/src/types/generated/ \
  --ts_proto_opt=outputJsonMethods=true,esModuleInterop=true \
  schemas/proto/desirelines/sports/v1/sports_metrics.proto
```

## Proto Consumers by File

| Proto | Go | Python | TypeScript |
|-------|-----|--------|------------|
| `activities.proto` | apigateway | - | web |
| `sports_metrics.proto` | apigateway | stravapipe | web |
| `user_config.proto` | apigateway | - | web |
| `webhook.proto` | dispatcher | stravapipe | - |

## Best Practices

### Naming

- **Files**: `snake_case.proto`
- **Messages**: `PascalCase`
- **Fields**: `snake_case` (converted to camelCase in JSON/TS)
- **Packages**: `desirelines.<domain>.v1`

### Field Numbers

- Reserve deleted field numbers: `reserved 5, 6;`
- Don't reuse field numbers
- Use 1-15 for frequently-used fields (1-byte encoding)

### Optional Fields

```protobuf
// Proto3: all fields optional by default
// Use wrapper types for explicit null semantics:
import "google/protobuf/wrappers.proto";

message Metric {
  google.protobuf.DoubleValue elevation_gain = 1;  // Can be null
}
```

### Comments

```protobuf
// Activity represents a single Strava activity.
// Used by the activities API endpoint.
message Activity {
  // Strava activity ID (unique identifier)
  int64 id = 1;

  // User-provided activity title
  string name = 2;
}
```

## Linting

```bash
# Lint with buf
just proto-lint

# Common issues:
# - Package name doesn't match directory structure
# - Missing go_package option
# - Field numbers not sequential
```

## Troubleshooting

### "Package not found" in Go

Ensure `go_mod_address` points to correct module:

```python
protobuf_sources(
    name="my_proto",
    sources=["..."],
    go_mod_address="packages/apigateway:mod",  # Must match go.mod location
)
```

### TypeScript imports broken

Check that proto files are included in `proto-gen-web` target:

```bash
# In Justfile, verify files are listed
grep proto-gen-web Justfile
```

### Python import errors

Ensure `python_resolve` matches your package:

```python
protobuf_sources(
    name="my_proto",
    sources=["..."],
    python_resolve="stravapipe",
)
```

### Generated code out of sync

```bash
# Regenerate
just proto-gen

# Verify changes
git diff packages/*/types/generated/
```

## Related

- [Domain Model](../architecture/domain-model.md) - Cross-package type glossary mapping proto types to their Go, Python, and TypeScript equivalents
- [schemas/proto/README.md](../../schemas/proto/README.md) - Proto directory structure
- [schemas/proto/BUILD](../../schemas/proto/BUILD) - Pants build targets
