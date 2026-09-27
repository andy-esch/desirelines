import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUserConfig } from "./useUserConfig";
import { TestServiceProvider } from "../contexts/ServiceContext";
import { AuthProvider } from "../contexts/AuthContext";
import { UserConfigProvider } from "../contexts/UserConfigProvider";
import { ToastProvider } from "../contexts/ToastContext";
import { MockAuthService } from "../services/auth/MockAuthService";
import { MockDatabaseService } from "../services/database/MockDatabaseService";
import { UserConfigService, type GoalsForYear } from "../services/userConfigService";
import { DEFAULT_PREFERENCES } from "../constants/settings";
import { DEMO_STORAGE_PREFIX, saveDemoSection } from "../services/demoStorage";

/**
 * Demo and account data never mix: signing in imports nothing from the demo and leaves its
 * storage alone, signing out copies nothing from the account, and signed-in code never reads a
 * demo key. The real hook and service run over the in-memory database; demo data is written
 * with `saveDemoSection`, the function the demo page and the hook's demo mode save through.
 */

const UID = "test-user-123";
const PATH = `users/${UID}/config/v1`;
const USER = { uid: UID, email: "a@b.com", displayName: "Test", photoURL: null };

const goal = (id: string, value: number) => ({
  id,
  value,
  label: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  metric: "distance_meters",
});
const DEMO_GOALS: GoalsForYear = { goals: [goal("demo", 5_000_000)], storageVersion: 2 };
const DEFAULT_GOALS: GoalsForYear = { goals: [goal("generated", 1_000_000)], storageVersion: 2 };
const DEMO_PREFERENCES = { ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" };

/** What each consumer last returned, by name, and the preferences consumer's save. */
let seen: Record<string, unknown> = {};
let savePreferences: (data: typeof DEFAULT_PREFERENCES) => Promise<void> = async () => {};

function GoalsConsumer({ report }: { report: (data: unknown) => void }) {
  const { data } = useUserConfig("goals", 2026, "cycling", DEFAULT_GOALS);
  useEffect(() => {
    report(data);
  }, [data, report]);
  return null;
}
function PrefsConsumer({
  report,
}: {
  report: (config: {
    data: unknown;
    updateData: (data: typeof DEFAULT_PREFERENCES) => Promise<void>;
  }) => void;
}) {
  const config = useUserConfig("preferences", undefined, undefined, DEFAULT_PREFERENCES);
  useEffect(() => {
    report(config);
  }, [config, report]);
  return null;
}

const demoStorage = () =>
  Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
      .filter((key) => key.startsWith(DEMO_STORAGE_PREFIX))
      .map((key) => [key, localStorage.getItem(key)])
  );

function renderApp(signedIn: boolean, db = new MockDatabaseService()) {
  const auth = new MockAuthService(signedIn ? USER : null);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <TestServiceProvider authService={auth} databaseService={db}>
          <AuthProvider>
            <UserConfigProvider>
              <GoalsConsumer report={(data) => (seen.goals = data)} />
              <PrefsConsumer
                report={(config) => {
                  seen.preferences = config.data;
                  savePreferences = config.updateData;
                }}
              />
            </UserConfigProvider>
          </AuthProvider>
        </TestServiceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  return { auth, db };
}

const settle = async () => {
  for (let tick = 0; tick < 5; tick++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
};

describe("demo and account data stay apart", () => {
  beforeEach(() => {
    localStorage.clear();
    seen = {};
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["returning signed in", "signing in on the page"])(
    "imports nothing from the demo and leaves its storage alone, %s",
    async (arrival) => {
      saveDemoSection("goals", DEMO_GOALS, 2026, "cycling");
      saveDemoSection("preferences", DEMO_PREFERENCES);
      const before = demoStorage();
      const writes = vi.spyOn(UserConfigService.prototype, "updateConfigSection");
      const { auth, db } = renderApp(arrival === "returning signed in");
      if (arrival === "signing in on the page") {
        await settle();
        expect(seen.preferences).toEqual(DEMO_PREFERENCES);
        await act(() => auth.signIn());
      }
      await settle();

      expect(writes).not.toHaveBeenCalled();
      expect(await db.getDocument(PATH)).toBeNull();
      expect(seen.goals).toEqual(DEFAULT_GOALS);
      expect(seen.preferences).toEqual(DEFAULT_PREFERENCES);
      expect(demoStorage()).toEqual(before);
    }
  );

  it("keeps a demo save made through the hook in the demo when the visitor signs in", async () => {
    const { auth, db } = renderApp(false);
    await settle();
    await act(() => savePreferences(DEMO_PREFERENCES));
    const saved = demoStorage();
    expect(Object.keys(saved)).toEqual([`${DEMO_STORAGE_PREFIX}preferences`]);

    await act(() => auth.signIn());
    await settle();

    expect(await db.getDocument(PATH)).toBeNull();
    expect(seen.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(demoStorage()).toEqual(saved);
  });

  it("never reads a demo key while signed in", async () => {
    saveDemoSection("goals", DEMO_GOALS, 2026, "cycling");
    saveDemoSection("preferences", DEMO_PREFERENCES);
    const reads = vi.spyOn(localStorage, "getItem");
    renderApp(true);
    await settle();

    const demoReads = reads.mock.calls
      .map(([key]) => key)
      .filter((key) => key.startsWith(DEMO_STORAGE_PREFIX));
    expect(demoReads).toEqual([]);
  });

  it("shows the demo's own data again after signing out, copying nothing from the account", async () => {
    saveDemoSection("preferences", DEMO_PREFERENCES);
    const before = demoStorage();
    const db = new MockDatabaseService();
    db.setMockData(PATH, {
      schemaVersion: "2.1",
      userId: UID,
      lastUpdated: "2026-01-01T00:00:00.000Z",
      preferences: { ...DEFAULT_PREFERENCES, distanceUnit: "miles", timezone: "Europe/Paris" },
    });
    const { auth } = renderApp(true, db);
    await waitFor(() =>
      expect((seen.preferences as typeof DEFAULT_PREFERENCES).timezone).toBe("Europe/Paris")
    );

    await act(() => auth.signOut());
    await settle();

    expect(seen.preferences).toEqual(DEMO_PREFERENCES);
    expect(demoStorage()).toEqual(before);
  });
});
