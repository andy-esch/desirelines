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
   * @param options Optional settings (merge: true to merge with existing)
   */
  setDocument<T>(path: string, data: T, options?: { merge?: boolean }): Promise<void>;

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
