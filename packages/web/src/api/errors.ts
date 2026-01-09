/**
 * API Error Utilities
 *
 * Standardized error handling patterns for the API layer.
 *
 * Philosophy:
 * - Request cancellation is NOT an error - it's expected cleanup behavior
 * - API functions should return empty data on cancellation, not throw
 * - This allows consumers to treat cancelled requests silently
 *
 * @see https://tanstack.com/query/latest/docs/react/guides/query-cancellation
 */

import axios from "axios";

/**
 * Check if an error is a request cancellation.
 *
 * Use this in catch blocks when you need to distinguish cancellation
 * from real errors. Prefer having API functions return empty data on
 * cancellation so consumers don't need this check.
 *
 * @example
 * ```ts
 * try {
 *   const data = await fetchData(signal);
 * } catch (err) {
 *   if (!isCancellationError(err)) {
 *     setError(err);
 *   }
 * }
 * ```
 */
export function isCancellationError(err: unknown): boolean {
  // Axios cancellation
  if (axios.isCancel(err)) {
    return true;
  }

  // Native fetch AbortError
  if (err instanceof DOMException && err.name === "AbortError") {
    return true;
  }

  // Legacy string-based check (for backwards compatibility during migration)
  if (err instanceof Error && err.message === "Request cancelled") {
    return true;
  }

  return false;
}

/**
 * Check if an HTTP error is an authentication/authorization failure.
 */
export function isAuthError(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    return status === 401 || status === 403;
  }
  return false;
}

/**
 * Check if an error is potentially retryable (network issues, server errors).
 */
export function isRetryableError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) {
    return false;
  }

  // Network errors are retryable (no response received)
  if (!err.response) {
    return true;
  }

  // 5xx server errors are retryable
  const status = err.response.status;
  return status >= 500;
}

/**
 * Check if an error is a 404 Not Found response.
 */
export function is404Error(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 404;
}

/**
 * Create a standardized auth error with user-friendly message.
 */
export function createAuthError(): Error {
  return new Error("Access denied. Please sign in with an authorized account.");
}

/**
 * Log an API error with context, but skip cancellations (expected behavior).
 *
 * @param err - The error to log
 * @param context - Function name or context for the log message
 */
export function logApiError(err: unknown, context: string): void {
  // Don't log cancellations - they're expected behavior
  if (isCancellationError(err)) {
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error(`${context}:`, message);
}

/**
 * Build authorization headers with optional Bearer token.
 */
export function buildAuthHeaders(idToken?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  }
  return headers;
}

/**
 * Standard error handler for API functions.
 * Logs the error and throws an appropriate exception.
 *
 * @param err - The caught error
 * @param context - Function name for logging
 * @throws Error - Always throws (auth error or original error)
 */
export function throwApiError(err: unknown, context: string): never {
  if (isAuthError(err)) {
    logApiError(err, context);
    throw createAuthError();
  }
  logApiError(err, context);
  throw err instanceof Error ? err : new Error(String(err));
}
