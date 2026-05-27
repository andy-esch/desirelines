/**
 * FirestoreService unit tests
 *
 * Focused on the write-side validation guard added to close the bug class
 * from 2026-03-23 (silent bad data persisted because writes were unvalidated).
 * The read-side validation path is exercised end-to-end via `userConfigService`
 * tests; here we pin the *write*-side throw-before-write behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { FirestoreService } from "./FirestoreService";
import * as firestore from "firebase/firestore";

vi.mock("firebase/app", () => ({
  initializeApp: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
}));

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => ({ app: { name: "[DEFAULT]" }, currentUser: null })),
  onAuthStateChanged: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(() => ({ type: "firestore", app: { name: "[DEFAULT]" } })),
  doc: vi.fn((..._args) => ({ path: "users/test/config/v1", type: "document" })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
}));

describe("FirestoreService.setDocument schema validation", () => {
  const service = new FirestoreService();
  const path = "users/test/config/v1";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(firestore.setDoc).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes through when no schema is supplied (back-compat)", async () => {
    await service.setDocument(path, { anything: 1, goes: "here" });
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
  });

  it("writes through when the supplied schema matches the data", async () => {
    const schema = z.object({ value: z.number() });
    await service.setDocument(path, { value: 42 }, { schema });
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
  });

  it("throws before the Firestore call when the schema rejects the data", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const schema = z.object({ value: z.string() });

    await expect(
      // Passing a number where a string is expected — the original bug class.
      // The deliberate `as` cast bypasses TS so the runtime validator gets to
      // see the malformed payload (which is what we're pinning here).
      service.setDocument<{ value: string }>(path, { value: 42 } as unknown as { value: string }, {
        schema,
      })
    ).rejects.toThrow(/Data validation failed for document at users\/test\/config\/v1/);

    // Critical: the write must not have happened.
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("forwards the merge option to setDoc", async () => {
    await service.setDocument(path, { value: 1 }, { merge: true });
    expect(firestore.setDoc).toHaveBeenCalledWith(expect.anything(), { value: 1 }, { merge: true });
  });

  it("defaults merge to false when omitted", async () => {
    await service.setDocument(path, { value: 1 });
    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.anything(),
      { value: 1 },
      { merge: false }
    );
  });
});
