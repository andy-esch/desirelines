/**
 * Mock implementation of DatabaseService for testing
 *
 * Provides in-memory document storage without Firestore dependencies.
 * Use setMockData() and clearMockData() to control test state.
 */

import type { DatabaseService, SetDocumentOptions } from "./DatabaseService";

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Firestore's `merge: true`: maps merge key by key; anything else, arrays included, replaces. */
function mergeInto(existing: unknown, incoming: unknown): unknown {
  if (!isMap(existing) || !isMap(incoming)) return incoming;
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    merged[key] = mergeInto(existing[key], value);
  }
  return merged;
}

export class MockDatabaseService implements DatabaseService {
  private data = new Map<string, unknown>();
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  getDocument<T>(path: string): Promise<T | null> {
    return Promise.resolve(this.read<T>(path));
  }

  setDocument<T>(path: string, data: T, options?: SetDocumentOptions<T>): Promise<void> {
    // Mirror FirestoreService: validate before the (mock) write so tests
    // exercise the same failure path as production.
    if (options?.schema) {
      const result = options.schema.safeParse(data);
      if (!result.success) {
        return Promise.reject(
          new Error(`Data validation failed for document at ${path}: ${result.error.message}`)
        );
      }
    }

    const stored = structuredClone(data);
    this.data.set(path, options?.merge ? mergeInto(this.data.get(path) ?? {}, stored) : stored);
    this.notifyListeners(path);
    return Promise.resolve();
  }

  deleteDocument(path: string): Promise<void> {
    this.data.delete(path);
    this.notifyListeners(path);
    return Promise.resolve();
  }

  subscribeToDocument<T>(
    path: string,
    callback: (data: T | null) => void,
    _onError?: (error: Error) => void
  ): () => void {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set());
    }

    const typedCallback = callback as (data: unknown) => void;
    this.listeners.get(path)!.add(typedCallback);

    // Immediately call with current data (matches Firestore behavior)
    callback(this.read<T>(path));

    return () => {
      const pathListeners = this.listeners.get(path);
      if (pathListeners) {
        pathListeners.delete(typedCallback);
        if (pathListeners.size === 0) {
          this.listeners.delete(path);
        }
      }
    };
  }

  /**
   * A copy of the stored document, as Firestore hands out a fresh object per read: a caller
   * that edits what it read (as a read-modify-write does) mustn't change what's stored.
   */
  private read<T>(path: string): T | null {
    const data = this.data.get(path);
    return data === undefined ? null : structuredClone(data as T);
  }

  private notifyListeners(path: string): void {
    const pathListeners = this.listeners.get(path);
    if (!pathListeners) return;

    pathListeners.forEach((callback) => callback(this.read(path)));
  }

  // ============================================
  // Test helper methods (not part of interface)
  // ============================================

  /**
   * Set mock data for a path (triggers subscription callbacks)
   */
  setMockData<T>(path: string, data: T): void {
    this.data.set(path, structuredClone(data));
    this.notifyListeners(path);
  }
}
