/**
 * Database service interface
 *
 * Abstracts document database (Firestore, etc.) from application code.
 * Provides basic CRUD operations and real-time subscriptions.
 */

import type { z } from "zod";

/**
 * Options for getDocument
 */
export interface GetDocumentOptions<T> {
  /** Zod schema for runtime validation. If provided, data will be validated before returning. */
  schema?: z.ZodType<T>;
}

/**
 * Options for subscribeToDocument
 */
export interface SubscribeDocumentOptions<T> {
  /** Zod schema for runtime validation. If provided, data will be validated before calling callback. */
  schema?: z.ZodType<T>;
}

/**
 * Options for setDocument
 */
export interface SetDocumentOptions<T> {
  /** When true, shallow-merge `data` into the existing document instead of overwriting. */
  merge?: boolean;
  /**
   * Zod schema for runtime validation. When provided, `data` is validated
   * **before** the database call — a validation failure throws synchronously
   * and the write does not happen.
   *
   * Mirrors the read-side `GetDocumentOptions.schema` pattern so the same
   * schema can guard reads and writes. Use this on any setDocument call that
   * targets a typed collection (e.g. user config) to make malformed writes
   * fail loudly at the source instead of silently persisting and breaking
   * later reads.
   */
  schema?: z.ZodType<T>;
}

export interface DatabaseService {
  /**
   * Get a document by path
   * @param path Document path (e.g., "users/123/config/v1")
   * @param options Optional settings including schema for validation
   * @returns Document data or null if not found
   */
  getDocument<T>(path: string, options?: GetDocumentOptions<T>): Promise<T | null>;

  /**
   * Set a document (creates or overwrites)
   * @param path Document path
   * @param data Document data
   * @param options Optional settings — `merge` shallow-merges into the
   *   existing doc; `schema` validates `data` before the write (throws on
   *   failure, write does not happen).
   */
  setDocument<T>(path: string, data: T, options?: SetDocumentOptions<T>): Promise<void>;

  /**
   * Delete a document
   * @param path Document path
   */
  deleteDocument(path: string): Promise<void>;

  /**
   * Subscribe to document changes
   * @param path Document path
   * @param callback Called with document data (or null) on changes
   * @param onError Called on subscription errors
   * @param options Optional settings including schema for validation
   * @returns Unsubscribe function
   */
  subscribeToDocument<T>(
    path: string,
    callback: (data: T | null) => void,
    onError?: (error: Error) => void,
    options?: SubscribeDocumentOptions<T>
  ): () => void;
}

/**
 * Database error with code for handling specific error types
 */
export interface DatabaseError extends Error {
  code: string;
}

/**
 * Check if an error is a DatabaseError
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error !== null && typeof error === "object" && "code" in error && "message" in error;
}
