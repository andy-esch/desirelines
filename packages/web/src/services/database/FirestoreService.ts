/**
 * Firestore implementation of DatabaseService
 *
 * Wraps Firestore SDK to provide a clean interface for the application.
 * All Firestore-specific code is contained here.
 */

import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  type DocumentSnapshot,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { logger } from "../../lib/logger";
import type {
  DatabaseService,
  GetDocumentOptions,
  SetDocumentOptions,
  SubscribeDocumentOptions,
} from "./DatabaseService";

// Retry configuration for subscriptions
const SUBSCRIPTION_RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000, // Start with 1 second
  maxDelayMs: 30000, // Cap at 30 seconds
};

/**
 * Check if an error is transient and worth retrying
 */
function isTransientError(error: Error & { code?: string }): boolean {
  const transientCodes = [
    "unavailable", // Service temporarily unavailable
    "resource-exhausted", // Rate limited / quota exceeded
    "deadline-exceeded", // Request timed out
    "aborted", // Operation aborted
    "internal", // Internal server error (may be transient)
  ];
  return transientCodes.includes(error.code ?? "");
}

/**
 * Calculate exponential backoff delay with jitter
 */
function getRetryDelay(attempt: number): number {
  const { baseDelayMs, maxDelayMs } = SUBSCRIPTION_RETRY_CONFIG;
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at maxDelayMs)
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(cappedDelay + jitter);
}

export class FirestoreService implements DatabaseService {
  async getDocument<T>(path: string, options?: GetDocumentOptions<T>): Promise<T | null> {
    const docRef = doc(db, path);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) return null;

    const data = snapshot.data();

    // Validate with schema if provided
    if (options?.schema) {
      const result = options.schema.safeParse(data);
      if (!result.success) {
        logger.error("Firestore data validation failed:", result.error);
        throw new Error(`Data validation failed for document at ${path}: ${result.error.message}`);
      }
      return result.data;
    }

    return data as T;
  }

  async setDocument<T>(path: string, data: T, options?: SetDocumentOptions<T>): Promise<void> {
    // Validate before the network call. We deliberately throw rather than
    // log-and-write because the original bug class this guard targets is
    // *silent* bad data — a write that succeeds and only fails later on read.
    // See the harden-user-config-goal-data-integrity task for context.
    if (options?.schema) {
      const result = options.schema.safeParse(data);
      if (!result.success) {
        logger.error("Firestore data validation failed on write:", result.error);
        throw new Error(`Data validation failed for document at ${path}: ${result.error.message}`);
      }
    }

    const docRef = doc(db, path);
    await setDoc(docRef, data as Record<string, unknown>, {
      merge: options?.merge ?? false,
    });
  }

  async deleteDocument(path: string): Promise<void> {
    const docRef = doc(db, path);
    await deleteDoc(docRef);
  }

  subscribeToDocument<T>(
    path: string,
    callback: (data: T | null) => void,
    onError?: (error: Error) => void,
    options?: SubscribeDocumentOptions<T>
  ): () => void {
    const docRef = doc(db, path);
    let unsubscribe: (() => void) | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let isCleanedUp = false;

    const handleSnapshot = (snapshot: DocumentSnapshot) => {
      // Reset retry count on successful snapshot
      retryCount = 0;

      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      const data = snapshot.data();

      // Validate with schema if provided
      if (options?.schema) {
        const result = options.schema.safeParse(data);
        if (!result.success) {
          logger.error("Firestore subscription data validation failed:", result.error);
          if (onError) {
            onError(
              new Error(`Data validation failed for document at ${path}: ${result.error.message}`)
            );
          }
          return;
        }
        callback(result.data);
        return;
      }

      callback(data as T);
    };

    const handleError = (error: Error & { code?: string }) => {
      // Don't retry if already cleaned up
      if (isCleanedUp) return;

      // Check if error is transient and we haven't exceeded max retries
      if (isTransientError(error) && retryCount < SUBSCRIPTION_RETRY_CONFIG.maxRetries) {
        const delay = getRetryDelay(retryCount);
        retryCount++;

        logger.warn(
          `Firestore subscription error (attempt ${retryCount}/${SUBSCRIPTION_RETRY_CONFIG.maxRetries}), ` +
            `retrying in ${delay}ms:`,
          error.code || error.message
        );

        // Schedule retry
        retryTimeout = setTimeout(() => {
          if (!isCleanedUp) {
            subscribe();
          }
        }, delay);
      } else {
        // Non-transient error or max retries exceeded - report to caller
        if (onError) {
          onError(error);
        } else {
          logger.error("Firestore subscription error (not retrying):", error);
        }
      }
    };

    const subscribe = () => {
      unsubscribe = onSnapshot(docRef, handleSnapshot, handleError);
    };

    // Start the subscription
    subscribe();

    // Return cleanup function
    return () => {
      isCleanedUp = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }
}
