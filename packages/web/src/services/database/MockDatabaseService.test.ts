import { describe, expect, it } from "vitest";
import { MockDatabaseService } from "./MockDatabaseService";

/** The mock's `merge: true` against Firestore's, checked on the emulator. */
describe("MockDatabaseService merge", () => {
  const PATH = "users/u/config/v1";

  async function mergeOnto(stored: unknown, write: unknown) {
    const db = new MockDatabaseService();
    db.setMockData(PATH, stored);
    await db.setDocument(PATH, write, { merge: true });
    return db.getDocument(PATH);
  }

  it("merges maps key by key at every depth", async () => {
    expect(
      await mergeOnto(
        { goals: { "2025": { n: 1 }, "2026": { a: 1, b: 2 } } },
        { goals: { "2026": { b: 3 } } }
      )
    ).toEqual({ goals: { "2025": { n: 1 }, "2026": { a: 1, b: 3 } } });
  });

  it("replaces arrays", async () => {
    expect(await mergeOnto({ list: [1, 2, 3] }, { list: [4] })).toEqual({ list: [4] });
  });

  it("replaces a map with an empty one", async () => {
    expect(await mergeOnto({ goals: { "2026": { a: 1 } }, keep: 1 }, { goals: {} })).toEqual({
      goals: {},
      keep: 1,
    });
  });
});
