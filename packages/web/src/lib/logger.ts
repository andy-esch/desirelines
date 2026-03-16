/**
 * Lightweight logger abstraction.
 *
 * Wraps console.* calls so that:
 * - Log levels can be filtered (debug/info/warn/error)
 * - Production builds only emit warn/error by default
 * - A single import replaces scattered console.* usage
 *
 * This is intentionally minimal — no external dependencies, no structured
 * metadata, no remote transport. It's a stepping-stone that makes it easy
 * to add those later without touching every call site.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Minimum log level. In production, suppress debug and info messages.
 * Can be overridden at runtime for debugging (e.g., via console or tests).
 */
let minLevel: LogLevel =
  typeof import.meta !== "undefined" && import.meta.env?.PROD ? "warn" : "debug";

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

/* eslint-disable no-console */
export const logger = {
  debug(...args: unknown[]): void {
    if (shouldLog("debug")) console.log(...args);
  },

  info(...args: unknown[]): void {
    if (shouldLog("info")) console.log(...args);
  },

  warn(...args: unknown[]): void {
    if (shouldLog("warn")) console.warn(...args);
  },

  error(...args: unknown[]): void {
    if (shouldLog("error")) console.error(...args);
  },

  /**
   * Set the minimum log level at runtime.
   * @internal — intended for tests and debugging.
   */
  setLevel(level: LogLevel): void {
    minLevel = level;
  },
};
/* eslint-enable no-console */
