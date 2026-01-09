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
    ├── config/v1/user_config.proto      # User settings (Firestore)
    ├── sports/v1/sports_metrics.proto   # Activity metrics API
    └── webhook/v1/webhook.proto         # Strava webhook events
```

## Quick Reference

```bash
# Generate AND sync all schemas (recommended)
make sync-schemas

# Generate all languages (proto only, no sport config)
make proto-gen

# Generate backend only (Go + Python)
make proto-gen-backend

# Generate web only (TypeScript)
make proto-gen-web

# Verify schemas are in sync (runs in CI)
make verify-schemas

# Lint schemas
make proto-lint

# Format schemas
make proto-fmt
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
make sync-schemas   # Regenerates code + copies config
git add schemas/ packages/*/types/generated/ packages/*/config/
```

**CI checks:** The `Schema Sync` job runs `make verify-schemas` to ensure copies are in sync.

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

option go_package = "desirelines/apigateway/types/generated";

message Activity {
  int64 id = 1;
  string name = 2;
  string sport_type = 3;
  double distance_meters = 4;
  int32 moving_time_seconds = 5;
  string start_date = 6;  // ISO 8601
}

message ActivityListResponse {
  repeated Activity activities = 1;
  string next_cursor = 2;
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
make proto-gen

# Or just backend (Go + Python)
make proto-gen-backend
```

### 4. Use Generated Types

**Go (apigateway):**
```go
import pb "desirelines/apigateway/types/generated"

func handleActivities(w http.ResponseWriter, r *http.Request) {
    response := &pb.ActivityListResponse{
        Activities: []*pb.Activity{
            {Id: 123, Name: "Morning Run", SportType: "Run"},
        },
    }
    respondProtobuf(w, response)  // Uses protojson for camelCase
}
```

**TypeScript (web):**
```typescript
import { Activity, ActivityListResponse } from '../types/generated/activities';

const response: ActivityListResponse = await api.get('/activities');
response.activities.forEach((a: Activity) => {
    console.log(a.name, a.distanceMeters);  // camelCase in TS
});
```

**Python (stravapipe):**
```python
from stravapipe.types.generated import activities_pb2

activity = activities_pb2.Activity(
    id=123,
    name="Morning Run",
    sport_type="Run",
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
make proto-gen
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

Generation happens in `dist/codegen/`, then Makefile copies to package directories.

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
make proto-lint

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
# In Makefile, verify files are listed
grep proto-gen-web Makefile
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
# Clean and regenerate
make proto-clean
make proto-gen

# Verify changes
git diff packages/*/types/generated/
```

## Related

- [schemas/proto/README.md](../../schemas/proto/README.md) - Proto directory structure
- [schemas/proto/BUILD](../../schemas/proto/BUILD) - Pants build targets
