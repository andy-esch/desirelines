# Protobuf Audit & Analysis

An audit of protobuf usage across the Desirelines monorepo, evaluated against
Google's official style guide, Buf's recommended practices, and industry best
practices for schema evolution, cross-language usage, and performance.

**Date:** 2026-03-25
**Scope:** All `.proto` files, generated code, adapter layers, and build configuration.

---

## Table of Contents

1. [Schema Inventory](#schema-inventory)
2. [What's Working Well](#whats-working-well)
3. [Issues & Recommendations](#issues--recommendations)
4. [Schema Evolution Readiness](#schema-evolution-readiness)
5. [Cross-Language Consistency](#cross-language-consistency)
6. [Tooling & Build System](#tooling--build-system)
7. [Action Items Summary](#action-items-summary)

---

## Schema Inventory

### Proto Source Files

| File | Package | Languages | Purpose |
|------|---------|-----------|---------|
| `webhook/v1/webhook.proto` | `desirelines.webhook.v1` | Go, Python | Strava webhook events |
| `activities/v1/activities.proto` | `desirelines.activities.v1` | Go, TypeScript | Activity CRUD + service def |
| `config/v1/user_config.proto` | `desirelines.config.v1` | Go, TypeScript | User preferences & goals |
| `sports/v1/sports_metrics.proto` | `desirelines.sports.v1` | Go, Python, TypeScript | Aggregated sport metrics |

### Generated Code Locations

| Service | Language | Path |
|---------|----------|------|
| dispatcher | Go | `packages/dispatcher/types/generated/` |
| apigateway | Go | `packages/apigateway/types/generated/` |
| stravapipe | Python | `packages/stravapipe/src/stravapipe/types/generated/` |
| web | TypeScript | `packages/web/src/types/generated/` |

---

## What's Working Well

### 1. Naming Conventions ✓

All schemas follow Google and Buf style guidelines:
- Messages use `PascalCase` (`WebhookEvent`, `DailyActivity`)
- Fields use `snake_case` (`object_id`, `distance_meters`)
- Enums use `UPPER_SNAKE_CASE` with type prefix (`ASPECT_TYPE_CREATE`, `METRIC_TYPE_DISTANCE_METERS`)
- Every enum has an `_UNSPECIFIED = 0` default value

### 2. Package Structure ✓

Packages use the recommended multi-component format (`desirelines.webhook.v1`),
versioned with `v1`, and organized into domain-specific directories matching the
package path.

### 3. Documentation ✓

All messages, fields, and enums have descriptive comments. The STANDARD buf lint
rule set (which includes documentation requirements) is enforced. Unit
conventions and cross-references to external docs (Strava API) are noted inline.

### 4. Buf Linting ✓

`buf.yaml` enforces the `STANDARD` rule set, which includes MINIMAL, BASIC, and
DEFAULT categories. This covers naming conventions, documentation, and structural
best practices.

### 5. Adapter Pattern ✓

Explicit adapter layers handle conversion between Strava's JSON format (string
enums, different field names) and protobuf types:
- Go: `dispatcher/adapters/proto/webhook_adapter.go`
- Python: `stravapipe/adapters/proto/webhook_adapter.py`

This keeps proto definitions clean and decoupled from the external API.

### 6. `optional` Usage ✓

Fields that are semantically nullable use `optional` correctly (e.g.,
`optional double elevation_meters`, `optional ActivityUpdates updates`). This
ensures proper presence tracking in proto3.

### 7. Unique Request/Response per RPC ✓

`activities.proto` defines unique request/response types per RPC method
(`ListActivitiesRequest`/`ListActivitiesResponse`,
`GetActivityRequest`/`GetActivityResponse`), following the Buf best practice of
never sharing request/response types across RPCs.

---

## Issues & Recommendations

### P1 — No Breaking Change Detection

**Issue:** There is no `buf breaking` check in CI. Schema changes could
accidentally break wire compatibility or JSON serialization across services.

**Risk:** High. With three languages consuming the same schemas, an accidental
field number reuse or type change would cause silent data corruption.

**Recommendation:** Add `buf breaking --against .git#branch=main` to the CI
pipeline. At minimum, use the `WIRE_JSON` category since all services use JSON
marshaling. The stricter `FILE` category (Buf's default) is recommended for
full protection.

### P1 — Timestamps as Strings Instead of Well-Known Types

**Issue:** Multiple schemas use `string` for timestamps:
- `user_config.proto`: `last_updated`, `created_at`, `updated_at` (6 fields)
- `activities.proto`: `start_date_local` (string, ISO 8601)
- `sports_metrics.proto`: `last_updated`, `date` fields

**Why it matters:** Google's official best practices explicitly say "don't
reinvent `google.protobuf.Timestamp`." String timestamps lose type safety,
require manual parsing in every consumer, and make it impossible to use protobuf's
built-in comparison and arithmetic operations.

**Recommendation:** For new fields, use `google.protobuf.Timestamp`. For
existing fields, this is a wire-breaking change, so either:
1. Add new `google.protobuf.Timestamp` fields alongside existing string fields
   and deprecate the old ones over time, or
2. Accept the current approach for fields already in production and only adopt
   `Timestamp` for new additions.

**Note:** Date-only fields like `start_date` ("2025-01-15") are a reasonable
exception — there is no standard protobuf type for dates without time.

### P2 — `activities.proto` Not Generated for Python or TypeScript

**Issue:** `activities.proto` is only generated for Go. The stravapipe Python
service and web TypeScript frontend don't receive generated code from this
schema.

**Impact:**
- Python pipeline processes activities but uses its own ad-hoc types instead of
  the shared proto contract
- TypeScript receives activities as JSON but lacks the generated types that
  would ensure compile-time compatibility

**Recommendation:** Generate `activities.proto` for Python and TypeScript.
Update `justfiles/backend.just` and `justfiles/web.just` accordingly.

### P2 — Duplicate `webhook.pb.go` in apigateway

**Issue:** `webhook.pb.go` is generated into both `packages/dispatcher/types/generated/`
and `packages/apigateway/types/generated/`, but only the dispatcher actually
uses webhook types. The apigateway copy appears unused.

**Risk:** Stale generated code that could confuse developers or cause import
conflicts.

**Recommendation:** Verify that apigateway does not import webhook types. If
confirmed unused, remove the generated file and update the generation script to
stop producing it there.

### P2 — No `reserved` Fields Documented

**Issue:** None of the proto files use `reserved` directives for deleted fields
or field numbers.

**Why it matters:** If any fields have been removed during development, their
numbers should be reserved to prevent accidental reuse. Even if no fields have
been removed yet, establishing the convention now prevents future mistakes.

**Recommendation:** Add a comment convention or contributing guide noting that
removed fields must always be reserved:
```protobuf
reserved 4, 8;
reserved "old_field_name";
```

### P3 — Single `go_package` for Multiple Schemas

**Issue:** `user_config.proto`, `sports_metrics.proto`, and `webhook.proto` (in
apigateway) all share the same `go_package`:
```
github.com/andy-esch/desirelines/packages/apigateway/types/generated
```

Only `activities.proto` has its own sub-package (`activitiesv1`).

**Impact:** All generated types land in the same Go package, increasing the risk
of name collisions as schemas grow. It also makes it harder to import only the
types you need.

**Recommendation:** Consider giving each proto domain its own Go sub-package:
- `generated/webhookv1`
- `generated/configv1`
- `generated/sportsv1`
- `generated/activitiesv1` (already done)

This is a breaking change for existing Go imports, so weigh the cost vs. benefit
for the current codebase size.

### P3 — gRPC Service Definition Without Runtime

**Issue:** `activities.proto` defines an `ActivityService` with RPC methods, but
the project uses REST/JSON, not gRPC. The generated Go code includes gRPC stubs
that are never used.

**Risk:** Low. The comment "Currently used for code generation; may become gRPC
service later" documents the intent. However, unused generated gRPC code adds
binary size and could confuse contributors.

**Recommendation:** If gRPC adoption is not planned near-term, consider removing
the `service` block and documenting the API contract elsewhere. If gRPC is
planned, keep it as-is.

### P3 — Field Number Allocation Gaps

**Issue:** `user_config.proto` jumps from field 3 to field 10 in `UserConfig`:
```protobuf
string last_updated = 3;
map<string, SportGoalsForYear> goals = 10;
```

**Assessment:** This is actually a *good* practice — reserving low field numbers
(1-15) for the most frequently accessed fields (which encode in 1 byte).
However, the gap is not documented, which could lead someone to "fill in" fields
4-9 with less common data.

**Recommendation:** Add a brief comment explaining the intentional gap:
```protobuf
// Fields 4-9 reserved for future high-frequency fields.
```

---

## Schema Evolution Readiness

| Criterion | Status | Notes |
|-----------|--------|-------|
| Field numbers stable | ✓ | No evidence of reuse |
| `_UNSPECIFIED` enum defaults | ✓ | All enums have zero value |
| `optional` for nullable fields | ✓ | Correctly applied |
| `reserved` directives | ✗ | Not used anywhere |
| Breaking change CI check | ✗ | No `buf breaking` in pipeline |
| Separate API vs storage protos | Partial | Protos define API shapes; Firestore uses native SDK |
| Versioned packages (`v1`) | ✓ | All packages versioned |

**Overall:** The schemas are well-positioned for evolution. Adding `buf breaking`
to CI and establishing a `reserved` convention would close the two remaining
gaps.

---

## Cross-Language Consistency

### Serialization Format

All services use JSON (not binary protobuf) for data interchange:
- **Go → HTTP:** `protojson.Marshal()` with `UseProtoNames=false` (camelCase)
- **Python:** Custom `dict_to_webhook_event()` / `proto_to_dict()` adapters
- **TypeScript:** Generated interfaces consumed directly from JSON responses

**Concern:** The Python adapter does manual dict-to-proto conversion rather than
using `google.protobuf.json_format.ParseDict()`. This means the Python layer
could silently accept malformed data that the proto schema would reject.

**Recommendation:** Consider using `json_format.ParseDict()` in Python for
automatic validation, or add explicit validation (the existing
`validate_webhook_event()` function partially addresses this).

### Enum Handling

Strava sends string enums (`"create"`, `"activity"`) while protobuf uses numeric
enums. Both Go and Python adapters handle this conversion correctly with explicit
mapping functions. This is well-implemented.

### Missing Cross-Language Coverage

| Schema | Go | Python | TypeScript |
|--------|----|--------|------------|
| webhook.proto | ✓ | ✓ | ✗ |
| activities.proto | ✓ | ✗ | ✓ |
| user_config.proto | ✓ | ✗ | ✓ |
| sports_metrics.proto | ✓ | ✓ | ✓ |

The gaps are mostly intentional (webhook isn't needed in the frontend,
user_config isn't needed in the pipeline), but `activities.proto` missing from
Python is worth addressing if the pipeline processes activity data.

---

## Tooling & Build System

### Current Stack

| Tool | Version | Purpose |
|------|---------|---------|
| Pants | 2.31.0 | Go + Python protobuf codegen |
| protoc-gen-ts_proto | 2.11.4 | TypeScript codegen |
| google.golang.org/protobuf | 1.36.11 | Go runtime |
| protobuf (Python) | ≥6.33.2 | Python runtime |
| buf (lint only) | via Pants | Schema linting |

### Observations

1. **Dual generation systems:** Pants handles Go/Python generation while a
   separate `protoc` invocation (via Justfile) handles TypeScript. This works
   but means TypeScript generation is not integrated into the Pants build graph.

2. **No `buf generate`:** The project uses Pants + raw protoc instead of Buf's
   unified `buf generate`. This is fine for the current setup but means missing
   out on Buf's managed mode (auto-configured language options) and remote
   plugins.

3. **Type stubs generated:** Python generation includes `.pyi` stubs
   (`generate_type_stubs = true`), which enables mypy checking of proto types.
   This is good practice.

### Recommendations

- **Add `buf breaking` to CI** (highest priority tooling improvement)
- **Consider `buf format`** for consistent proto file formatting
- **Evaluate Buf CLI for generation** if the Pants + protoc dual system becomes
  hard to maintain

---

## Action Items Summary

| Priority | Item | Effort |
|----------|------|--------|
| **P1** | Add `buf breaking` to CI pipeline | Small |
| **P1** | Adopt `google.protobuf.Timestamp` for new timestamp fields | Medium |
| **P2** | Generate `activities.proto` for Python and TypeScript | Small |
| **P2** | Remove unused `webhook.pb.go` from apigateway (if confirmed unused) | Small |
| **P2** | Establish `reserved` field convention in contributing guide | Small |
| **P3** | Separate `go_package` per proto domain | Medium (breaking) |
| **P3** | Document field number gap strategy in `UserConfig` | Small |
| **P3** | Evaluate removing gRPC service definition if not planned | Small |
