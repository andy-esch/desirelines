# API Client Layer

TypeScript API client for the Desirelines API Gateway.

## Error Handling Philosophy

**Core principle**: Request cancellation is NOT an error - it's expected cleanup behavior.

### How Errors Are Handled

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| Success | Return data | Normal flow |
| Cancellation (AbortController) | Return empty data | Expected cleanup, not error |
| 404 Not Found | Return empty/null | No data is valid state |
| 401/403 Auth error | Throw with user message | User action required |
| Network/5xx errors | Throw original error | Retryable, needs handling |

### API Contract

The API Gateway follows a consistent pattern (see [apigateway README](../../../packages/apigateway/README.md#response-codes)):

- **200**: Success - empty data returns `[]` or `{}`, not 404
- **400**: Invalid request (bad parameters)
- **401/403**: Authentication/authorization failure
- **404**: Resource not found (only for `/activities/{id}`)
- **500/503**: Server errors

## Using the Error Utilities

All error handling utilities are in `errors.ts`:

```typescript
import {
  isCancellationError,  // Check if error is a cancellation
  is404Error,           // Check if error is 404
  isAuthError,          // Check if error is 401/403
  isRetryableError,     // Check if error is network/5xx
  buildAuthHeaders,     // Build Authorization header
  throwApiError,        // Standard error handler (logs + throws)
} from "./errors";
```

### In API Functions

```typescript
export const fetchSomething = async (
  id: string,
  signal?: AbortSignal,
  idToken?: string
): Promise<Something | null> => {
  const url = `${getApiBaseUrl()}/something/${id}`;

  try {
    const { data } = await axios.get<Something>(url, {
      signal,
      headers: buildAuthHeaders(idToken),
    });
    return data;
  } catch (err: unknown) {
    // Cancellation: return empty (not an error)
    if (isCancellationError(err)) {
      return null;
    }
    // 404: return null (resource doesn't exist)
    if (is404Error(err)) {
      return null;
    }
    // All other errors: log and throw
    throwApiError(err, "fetchSomething");
  }
};
```

### In React Hooks/Components

```typescript
useEffect(() => {
  const controller = new AbortController();

  async function loadData() {
    try {
      const data = await fetchSomething(id, controller.signal, token);
      setData(data);
    } catch (err) {
      // API functions return empty on cancel, so this only catches real errors
      if (!isCancellationError(err)) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  loadData();
  return () => controller.abort();  // Cleanup cancels in-flight requests
}, [id, token]);
```

## Adding a New API Function

1. **Define the function** following the pattern above
2. **Handle cancellation** - return empty data, don't throw
3. **Handle 404** if applicable - return null/empty
4. **Use `throwApiError`** for all other errors
5. **Add tests** covering: success, cancellation, 404, auth errors, network errors

### Template

```typescript
/**
 * Fetches [description].
 *
 * @param id - Resource identifier
 * @param signal - AbortSignal for cancellation
 * @param idToken - Optional Firebase auth token
 * @returns Promise resolving to data, null if not found, empty on cancel
 * @throws Error on auth or network failures
 */
export const fetchXxx = async (
  id: string,
  signal?: AbortSignal,
  idToken?: string
): Promise<XxxType | null> => {
  const url = `${getApiBaseUrl()}/xxx/${id}`;

  try {
    const { data } = await axios.get<XxxType>(url, {
      signal,
      headers: buildAuthHeaders(idToken),
    });
    return data;
  } catch (err: unknown) {
    if (isCancellationError(err)) {
      return null;
    }
    if (is404Error(err)) {
      return null;
    }
    throwApiError(err, "fetchXxx");
  }
};
```

## Testing API Functions

Each API function should have tests for:

```typescript
describe("fetchXxx", () => {
  it("should return data on success", async () => { ... });
  it("should return null/empty on cancellation", async () => { ... });
  it("should return null on 404", async () => { ... });
  it("should throw on 401/403", async () => { ... });
  it("should throw on network error", async () => { ... });
});
```

See `activities.test.ts` for examples.

## Files

| File | Purpose |
|------|---------|
| `activities.ts` | API functions for activities, metrics, metadata |
| `errors.ts` | Error utilities (detection, headers, logging) |
| `errors.test.ts` | Tests for error utilities |
| `activities.test.ts` | Tests for API functions |

## Related Documentation

- [API Gateway README](../../../packages/apigateway/README.md) - Backend API documentation
- [API Gateway Response Codes](../../../packages/apigateway/README.md#response-codes) - HTTP status code contract
