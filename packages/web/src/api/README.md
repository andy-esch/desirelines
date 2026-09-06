# API Client Layer

TypeScript API client for the Desirelines API Gateway.

## Error Handling Philosophy

**Core principle**: Request cancellation is NOT an error - it's expected cleanup behavior.

### How Errors Are Handled

| Scenario                       | Behavior                | Rationale                   |
| ------------------------------ | ----------------------- | --------------------------- |
| Success                        | Return data             | Normal flow                 |
| Cancellation (AbortController) | Re-thrown untouched     | TanStack Query owns it      |
| 404 Not Found                  | Return empty/null       | No data is valid state      |
| 401/403 Auth error             | Throw with user message | User action required        |
| Network/5xx errors             | Throw original error    | Retryable, needs handling   |

### API Contract

The API Gateway follows a consistent pattern (see [`openapi.yaml`](../../../apigateway/openapi.yaml)):

- **200**: Success - empty data returns `[]` or `{}`, not 404
- **400**: Invalid request (bad parameters)
- **401/403**: Authentication/authorization failure
- **404**: Resource not found (only for `/activities/{id}`)
- **500/503**: Server errors

## Using the Error Utilities

Error handling utilities live in `errors.ts`. Auth headers are not among them —
`client.ts` attaches those, and `url.ts`'s `isInternalRequest` decides who is
allowed to receive one:

```typescript
import {
  isCancellationError, // Check if error is a cancellation
  is404Error, // Check if error is 404
  isAuthError, // Check if error is 401/403
  isRetryableError, // Check if error is network/5xx
  redactAuthorizationHeader, // Strip credentials before an error is logged
  logApiError, // Log without throwing
  throwApiError, // Standard error handler (logs + throws)
} from "./errors";
```

### In API Functions

```typescript
import getClient from "./client";
import { validateApiResponse, SomethingResponseSchema } from "./contracts";
import { throwApiError } from "./errors";

export const fetchSomething = async (
  id: string,
  signal?: AbortSignal
): Promise<Something> => {
  // Relative path — getClient() carries the base URL and the auth header.
  const url = `something/${id}`;

  try {
    const { data: raw } = await getClient().get<Something>(url, signal ? { signal } : {});
    return validateApiResponse<Something>(SomethingResponseSchema, raw, "fetchSomething");
  } catch (err: unknown) {
    throwApiError(err, "fetchSomething");
  }
};
```

### In React Hooks/Components

```typescript
// Server state goes through TanStack Query, which owns the AbortSignal and
// the retry policy. The query key must include the user id so a sign-out or
// account switch cannot serve the previous user's cache.
const { data, isPending, error } = useQuery({
  queryKey: ["something", user?.uid, id],
  queryFn: ({ signal }) => fetchSomething(id, signal),
});
```

## Adding a New API Function

1. **Define the function** following the pattern above
2. **Take a `signal`** and pass it straight through to `getClient()`
3. **Validate the response** with a zod schema from `contracts.ts`
4. **Use `throwApiError`** in a single catch — do not branch on error type
5. **Add tests** covering: success, cancellation, 404, auth errors, network errors

### Template

```typescript
/**
 * Fetches [description].
 *
 * @param id - Resource identifier
 * @param signal - AbortSignal for cancellation, supplied by TanStack Query
 * @returns Promise resolving to the validated response
 * @throws Error on cancellation, auth, validation or network failures
 */
export const fetchXxx = async (id: string, signal?: AbortSignal): Promise<XxxType> => {
  const url = `xxx/${id}`;

  try {
    const { data: raw } = await getClient().get<XxxType>(url, signal ? { signal } : {});
    return validateApiResponse<XxxType>(XxxResponseSchema, raw, "fetchXxx");
  } catch (err: unknown) {
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

| File            | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `client.ts`     | The configured axios instance (`getClient`), auth + tracing |
| `activities.ts` | API functions for activities, metrics, metadata            |
| `map.ts`        | Map dataset, route regions and tile metadata               |
| `contracts.ts`  | Zod response schemas + `validateApiResponse`               |
| `errors.ts`     | Error detection, redaction, logging, `throwApiError`       |
| `url.ts`        | `isInternalRequest` — gates who may receive an auth header |
| `trace.ts`      | Trace-context propagation for outbound requests            |

## Related Documentation

- [API Gateway README](../../../apigateway/README.md) - Backend API documentation
- [OpenAPI Specification](../../../apigateway/openapi.yaml) - Canonical API contract (endpoints, parameters, schemas)
