# Protocol Buffer Schemas

This directory contains Protocol Buffer schema definitions that serve as the **single source of truth** for data contracts across the desirelines monorepo.

## Overview

Protocol Buffers provide:
- ✅ **Type safety** across Go, Python, and TypeScript
- ✅ **Schema evolution** with backward/forward compatibility
- ✅ **Automatic code generation** for all languages
- ✅ **Runtime validation** (via generated code)
- ✅ **Smaller payloads** compared to JSON (when using binary format)

## Directory Structure

```
schemas/
├── proto/                    # Source proto files (commit these)
│   ├── user_config.proto     # User configuration data
│   └── README.md             # This file
│
├── generated/                # Generated code (gitignored)
│   ├── go/
│   │   └── userconfig/
│   ├── python/
│   │   └── userconfig/
│   └── typescript/
│       └── userconfig/
│
└── bigquery/                 # BigQuery table schemas
    └── *.json
```

## Current Schemas

### `user_config.proto`

Defines user configuration data stored in Firestore.

**Usage:**
- Frontend: User goals, annotations, preferences
- Storage: Firestore `users/{userId}/config/v1` documents
- Languages: TypeScript (frontend), Go (future API Gateway)

**Document path**: `users/{userId}/config/v1`

## Code Generation

### Prerequisites

Install Protocol Buffer compiler:

```bash
# macOS
brew install protobuf

# Verify installation
protoc --version  # Should be 3.x or later
```

### Generate Code

From the repository root:

```bash
# Generate all languages
make proto-gen

# Or generate individually
make proto-gen-go
make proto-gen-typescript
make proto-gen-python  # Future
```

### Generated Code Locations

- **Go**: `schemas/generated/go/userconfig/user_config.pb.go`
- **TypeScript**: `schemas/generated/typescript/userconfig/user_config.ts`
- **Python**: `schemas/generated/python/userconfig/user_config_pb2.py` (future)

## Usage Examples

### Go (Future)

```go
import (
    pb "github.com/andy-esch/desirelines/schemas/generated/go/userconfig"
)

// Create config
config := &pb.UserConfig{
    SchemaVersion: "1.0",
    UserId: "user123",
    LastUpdated: time.Now().Format(time.RFC3339),
    Goals: map[string]*pb.GoalsForYear{
        "2025": {
            Goals: []*pb.Goal{
                {Id: "1", Value: 2500, Label: "Target"},
            },
        },
    },
}

// Marshal to JSON for Firestore
jsonData, _ := protojson.Marshal(config)
```

### TypeScript (Frontend)

```typescript
import { UserConfig, Goal } from '@/schemas/generated/typescript/userconfig/user_config';

// Create config
const config: UserConfig = {
  schemaVersion: '1.0',
  userId: 'user123',
  lastUpdated: new Date().toISOString(),
  goals: {
    '2025': {
      goals: [
        { id: '1', value: 2500, label: 'Target', createdAt: '...', updatedAt: '...' }
      ]
    }
  },
  preferences: {
    theme: 'dark',
    defaultYear: 2025,
    chartDefaults: { showAverage: true, showGoals: true }
  },
  metadata: {
    createdAt: '...',
    lastSyncedDevice: 'chrome-macbook',
    configTypes: ['goals', 'preferences']
  }
};
```

## Schema Evolution

### Adding New Fields (Safe)

```protobuf
message Goal {
  string id = 1;
  int32 value = 2;
  string label = 3;
  string created_at = 4;
  string updated_at = 5;
  string color = 6;  // NEW - old code ignores this
}
```

**Rules:**
- ✅ Always use new field numbers
- ✅ New fields are optional by default in proto3
- ✅ Old code safely ignores new fields
- ✅ New code provides defaults for missing fields

### Breaking Changes (Requires Migration)

The following require creating a new version (e.g., `user_config_v2.proto`):
- ❌ Removing fields
- ❌ Changing field types
- ❌ Changing field semantics
- ❌ Renumbering fields

For breaking changes, follow the version-as-document migration pattern:
1. Create new proto version (v2)
2. Generate new types
3. Read v2 first, fall back to v1
4. Migrate v1 → v2 in background
5. Delete v1 documents after migration complete

## Related Documentation

- 📄 [Protobuf Schema Migration Plan](../../docs/planning/archive/protobuf-schema-migration.md) - Future protobuf usage for activity pipeline
- 📄 [Protobuf for Frontend Chart Data](../../docs/planning/archive/protobuf-frontend-data.md) - Future protobuf for API data
- 🔨 [Frontend User Config Storage Architecture](../../docs/planning/tasks/in-progress/frontend-user-config-storage-architecture.md) - Active task using `user_config.proto`

## Adding New Schemas

1. Create new `.proto` file in this directory
2. Define messages with proper field numbers
3. Update code generation scripts (Makefile)
4. Generate code for all target languages
5. Import generated types in your code

Example:
```bash
# Create new schema
touch schemas/proto/activity.proto

# Update Makefile to include new schema
# Generate code
make proto-gen

# Use in code
import { Activity } from '@/schemas/generated/typescript/activity/activity';
```

## Troubleshooting

### "protoc: command not found"
Install Protocol Buffer compiler (see Prerequisites above)

### Generated code not found
Run `make proto-gen` from repository root

### Import errors
Ensure generated code is in the correct language-specific import path

### Schema validation errors
Check field numbers are unique and sequential
