/**
 * Global error handlers for the browser window.
 *
 * Captures errors that escape React's render tree (and the root
 * `<ErrorBoundary>` in `index.tsx`):
 *
 * - `window.onerror` — uncaught synchronous errors (event handlers, timers,
 *   non-React script errors, etc.)
 * - `window.onunhandledrejection` — promise rejections that no `.catch()` or
 *   `await` handled
 *
 * Errors are logged via the shared `logger` so they show up in the browser
 * console (and any future remote transport added there in one place).
 *
 * Authorization headers are stripped via `redactAuthorizationHeader` before
 * any logging — the same redaction the API layer's `throwApiError` uses —
 * so bearer tokens never leak through these last-resort handlers.
 *
 * Call `installGlobalErrorHandlers()` exactly once at app entry. Calling it
 * multiple times is a no-op (the second call returns early).
 */

import { redactAuthorizationHeader } from "../api/errors";
import { logger } from "./logger";

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    const error: unknown = event.error;
    redactAuthorizationHeader(error);
    logger.error("Unhandled error", {
      message: event.message,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error,
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    redactAuthorizationHeader(reason);
    logger.error("Unhandled promise rejection", { reason });
  });
}

/**
 * Reset the installed flag. Test-only — do not call from production code.
 * @internal
 */
export function _resetInstalledForTests(): void {
  installed = false;
}
