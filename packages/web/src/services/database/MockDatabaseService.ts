/**
 * Mock implementation of DatabaseService for testing
 *
 * Provides in-memory document storage without Firestore dependencies.
 * Use setMockData() and clearMockData() to control test state.
 */

import type { DatabaseService, SetDocumentOptions } from "./DatabaseService";

export class MockDatabaseService implements DatabaseService {
  private data = new Map<string, unknown>();
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  getDocument<T>(path: string): Promise<T | null> {
    const data = this.data.get(path);
    return Promise.resolve((data as T) ?? null);
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

    if (options?.merge) {
      const existing = this.data.get(path) ?? {};
      this.data.set(path, { ...existing, ...(data as object) });
    } else {
      this.data.set(path, data);
    }
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
    callback((this.data.get(path) as T) ?? null);

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

  private notifyListeners(path: string): void {
    const pathListeners = this.listeners.get(path);
    if (!pathListeners) return;

    const data = this.data.get(path) ?? null;
    pathListeners.forEach((callback) => callback(data));
  }

  // ============================================
  // Test helper methods (not part of interface)
  // ============================================

  /**
   * Set mock data for a path (triggers subscription callbacks)
   */
  setMockData<T>(path: string, data: T): void {
    this.data.set(path, data);
    this.notifyListeners(path);
  }

  /**
   * Get all stored data (for test assertions)
   */
  getAllData(): Map<string, unknown> {
    return new Map(this.data);
  }

  /**
   * Clear all mock data
   */
  clearMockData(): void {
    const paths = Array.from(this.data.keys());
    this.data.clear();
    // Notify all listeners that data is gone
    paths.forEach((path) => this.notifyListeners(path));
  }

  /**
   * Check if a path has any data
   */
  hasData(path: string): boolean {
    return this.data.has(path);
  }
}
