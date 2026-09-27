import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createFirestoreAdapter } from "./firestoreAdapter";
import { createDemoAdapter } from "./demoAdapter";
import { selectSection } from "./sections";
import { MockAuthService } from "../auth/MockAuthService";
import { MockDatabaseService } from "../database/MockDatabaseService";
import { demoConfigKey, saveDemoSection } from "../demoStorage";
import { DEFAULT_PREFERENCES } from "../../constants/settings";
import type { GoalsForYear, UserConfig } from "../userConfigService";

const USER = { uid: "athlete-1", email: "a@b.com", displayName: "A", photoURL: null };
const PATH = `users/${USER.uid}/config/v1`;
const goals = (id: string): GoalsForYear => ({
  goals: [{ id, value: 1000, label: id, createdAt: "", updatedAt: "", metric: "distance_meters" }],
  storageVersion: 2,
});
const stored = (id: string): UserConfig => ({
  schemaVersion: "2.1",
  userId: USER.uid,
  lastUpdated: "2026-01-01T00:00:00Z",
  goals: { "2026": { sports: { cycling: goals(id) } } },
  annotations: {},
});
const cycling = { section: "goals", year: 2026, sport: "cycling" } as const;

describe("the Firestore adapter", () => {
  let db: MockDatabaseService;
  const adapter = () =>
    createFirestoreAdapter(USER.uid, {
      authService: new MockAuthService(USER),
      databaseService: db,
    });

  beforeEach(() => {
    db = new MockDatabaseService();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("loads from its listener's first snapshot, with no read of its own", async () => {
    db.setMockData(PATH, stored("first"));
    const reads = vi.spyOn(db, "getDocument");
    const a = adapter();
    const loaded = a.load();
    a.subscribe!(vi.fn(), vi.fn());

    expect(selectSection(await loaded, cycling)).toEqual(goals("first"));
    expect(reads).not.toHaveBeenCalled();
  });

  it("answers a later load with the latest snapshot, not an older read", async () => {
    db.setMockData(PATH, stored("first"));
    const a = adapter();
    a.subscribe!(vi.fn(), vi.fn());
    db.setMockData(PATH, stored("second"));

    expect(selectSection(await a.load(), cycling)).toEqual(goals("second"));
  });

  it("loads null for an account with nothing saved", async () => {
    const a = adapter();
    a.subscribe!(vi.fn(), vi.fn());
    expect(await a.load()).toBeNull();
  });

  it("fails the load when the listener fails before any snapshot", async () => {
    vi.spyOn(db, "subscribeToDocument").mockImplementation((_path, _onData, onError) => {
      onError?.(new Error("permission-denied"));
      return () => {};
    });
    const a = adapter();
    const onError = vi.fn();
    const loaded = a.load();
    a.subscribe!(vi.fn(), onError);

    await expect(loaded).rejects.toThrow("permission-denied");
    await expect(a.load()).rejects.toThrow("permission-denied");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("keeps its last good copy for later loads when the listener fails after one", async () => {
    db.setMockData(PATH, stored("good"));
    const a = adapter();
    const onChange = vi.fn();
    const onError = vi.fn();
    a.subscribe!(onChange, onError);

    db.failListeners(PATH, new Error("offline"));

    expect(onError).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(selectSection(await a.load(), cycling)).toEqual(goals("good"));
  });

  it("saves one section, with no read", async () => {
    db.setMockData(PATH, {
      ...stored("cycling"),
      preferences: { ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" },
    });
    const reads = vi.spyOn(db, "getDocument");

    await adapter().saveSection({ section: "goals", year: 2026, sport: "running" }, goals("run"));

    const doc = await db.getDocument<UserConfig>(PATH);
    expect(doc?.goals["2026"]?.sports).toEqual({
      cycling: goals("cycling"),
      running: goals("run"),
    });
    expect(doc?.preferences?.distanceUnit).toBe("kilometers");
    expect(reads).toHaveBeenCalledTimes(1); // the check above, not the save
  });
});

describe("the demo adapter", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("gathers the demo's saved sections into one document", async () => {
    saveDemoSection("goals", goals("demo"), 2026, "cycling");
    saveDemoSection("annotations", { annotations: [] }, 2026);
    saveDemoSection("preferences", { ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" });

    const doc = await createDemoAdapter().load();

    expect(selectSection(doc, cycling)).toEqual(goals("demo"));
    expect(selectSection(doc, { section: "annotations", year: 2026 })).toEqual({
      annotations: [],
    });
    expect(selectSection(doc, { section: "preferences" })?.distanceUnit).toBe("kilometers");
  });

  it("loads null with nothing saved, whatever else is in storage", async () => {
    localStorage.setItem("demo.theme", "arcade");
    localStorage.setItem("account.theme", "miami");
    localStorage.setItem("unrelated", "{}");

    expect(await createDemoAdapter().load()).toBeNull();
  });

  it("leaves out a section that isn't valid, as if nothing were saved there", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    saveDemoSection("goals", goals("ok"), 2026, "running");
    localStorage.setItem(demoConfigKey("goals", 2026, "cycling"), '{"goals":"not an array"}');
    localStorage.setItem(demoConfigKey("goals", 2026, "hiking"), "not json");

    const doc = await createDemoAdapter().load();

    expect(selectSection(doc, cycling)).toBeNull();
    expect(selectSection(doc, { section: "goals", year: 2026, sport: "hiking" })).toBeNull();
    expect(selectSection(doc, { section: "goals", year: 2026, sport: "running" })).toEqual(
      goals("ok")
    );
  });

  it("loads null when storage can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    saveDemoSection("goals", goals("demo"), 2026, "cycling");
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(await createDemoAdapter().load()).toBeNull();
  });

  it("saves a section under its demo key, and fails when storage refuses", async () => {
    const adapter = createDemoAdapter();
    await adapter.saveSection(cycling, goals("saved"));
    expect(JSON.parse(localStorage.getItem(demoConfigKey("goals", 2026, "cycling"))!)).toEqual(
      goals("saved")
    );

    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    await expect(adapter.saveSection(cycling, goals("more"))).rejects.toThrow("QuotaExceeded");
  });

  it("has no listener: nothing else writes the demo's storage", () => {
    expect(createDemoAdapter().subscribe).toBeUndefined();
  });
});
