# Shared Test Fixtures

Cross-language test fixtures that ensure Go (dispatcher) and Python (stravapipe) webhook adapters produce identical results from the same inputs.

## Why

The `webhook.proto` schema is the source of truth, but each language has a hand-written adapter that maps between Strava JSON and protobuf types. If someone adds a field to the proto without updating both adapters, drift goes undetected until runtime. Shared fixtures catch this at test time.

## Structure

`webhook_events.json` contains an array of test cases:

```json
{
  "name": "human-readable label",
  "input": {
    "aspect_type": "create",
    "object_type": "activity",
    "object_id": 12345,
    "owner_id": 67890,
    "event_time": 1704067200,
    "subscription_id": 999,
    "updates": {"title": "Morning Run"}
  },
  "expected": {
    "aspect_type": "create",
    "object_type": "activity",
    "object_id": 12345,
    "owner_id": 67890,
    "event_time": 1704067200,
    "subscription_id": 999,
    "updates": {
      "title": "Morning Run"
    }
  },
  "expect_error": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable test case label |
| `input` | object | Strava JSON dict (string enums, snake_case fields) |
| `expected` | object \| null | Expected parsed field values after adapter conversion. `null` for error cases. `updates` is `null` when no updates are expected, or an object with typed values (booleans for `private`, strings for `title`/`type`). |
| `expect_error` | boolean | Whether the adapter should return an error |

### `expected.updates` conventions

- `null` — no updates expected (create/delete events, non-activity objects)
- `{}` — would mean empty updates (not currently used)
- `{"title": "...", "type": "...", "private": true/false}` — only the fields present in the Strava `updates` dict. Note that `private` is a **boolean** in expected (the adapter converts from Strava's `"true"`/`"false"` strings).

## How tests consume fixtures

### Go (`packages/dispatcher/adapters/proto/webhook_adapter_test.go`)

`TestSharedFixtures` reads the JSON file using `os.ReadFile` with a relative path (`../../../schemas/test-fixtures/webhook_events.json`), iterates over cases, and:
- For non-error cases: calls `ParseStravaWebhook(input)` and asserts all fields match `expected`
- For error cases: asserts `ParseStravaWebhook` returns an error
- Tests roundtrip: `ParseStravaWebhook` → `ToStravaJSON` → parse again → verify equality

### Python (`packages/stravapipe/tests/unit/adapters/proto/test_webhook_adapter.py`)

`TestSharedFixtures` reads the JSON file using `pathlib.Path`, uses `@pytest.mark.parametrize` over the fixture cases, and:
- For non-error cases: calls `dict_to_webhook_event(input)` and asserts all fields match `expected`
- For error cases: asserts `ValueError` is raised
- Tests roundtrip: `dict_to_webhook_event` → `proto_to_dict` → compare to input

## Adding a new fixture

When the proto changes (new field, new enum value):

1. Add a test case to `webhook_events.json` covering the new field/value
2. Run `just go-test` and `just py-test` — both should fail until the adapters are updated
3. Update both adapters to handle the new field
4. Run `just verify-schemas` — the field-coverage script will also validate both adapters reference the new field

## Relationship to `verify-webhook-adapters`

The `scripts/verify-webhook-adapters.sh` script (run via `just verify-schemas`) provides a complementary check: it extracts field names and enum values from `webhook.proto` and verifies both adapter source files reference them. This catches the case where someone adds a proto field but forgets to update both the fixtures _and_ the adapters.
