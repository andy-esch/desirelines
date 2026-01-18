/**
 * Firestore implementation of DatabaseService
 *
 * Wraps Firestore SDK to provide a clean interface for the application.
 * All Firestore-specific code is contained here.
 */

import { doc, getDoc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { DatabaseService } from "./DatabaseService";

export class FirestoreService implements DatabaseService {
  async getDocument<T>(path: string): Promise<T | null> {
    const docRef = doc(db, path);
    const snapshot = await getDoc(docRef);

    if (!snapshot.exists()) return null;
    return snapshot.data() as T;
  }

  async setDocument<T>(path: string, data: T, options?: { merge?: boolean }): Promise<void> {
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
    onError?: (error: Error) => void
  ): () => void {
    const docRef = doc(db, path);

    return onSnapshot(
      docRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          callback(null);
          return;
        }
        callback(snapshot.data() as T);
      },
      (error) => {
        if (onError) {
          onError(error);
        } else {
          console.error("Firestore subscription error:", error);
        }
      }
    );
  }
}

// Singleton instance for the application
let instance: FirestoreService | null = null;

export function getFirestoreService(): FirestoreService {
  if (!instance) {
    instance = new FirestoreService();
  }
  return instance;
}
