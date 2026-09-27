import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserConfigProvider } from "./UserConfigProvider";
import { TestServiceProvider } from "./ServiceContext";
import { AuthProvider } from "./AuthContext";
import { ToastProvider } from "./ToastContext";
import { usePreferences } from "../hooks/usePreferences";
import { useAllGoals, useGoals } from "../hooks/useGoals";
import { useAnnotations } from "../hooks/useAnnotations";
import { MockAuthService } from "../services/auth/MockAuthService";
import { MockDatabaseService } from "../services/database/MockDatabaseService";
import { UserConfigSchema, type GoalsForYear } from "../services/userConfigService";
import { DEFAULT_PREFERENCES } from "../constants/settings";
import { configQueryKey } from "../services/config/configAdapter";
import { ACCOUNT_CONFIG_PATH as PATH, ACCOUNT_USER, storedGoal } from "../test/fixtures/userConfig";

const goals = (id: string): GoalsForYear => ({
  goals: [storedGoal(id, 1_000_000)],
  storageVersion: 2,
});
const STORED = {
  schemaVersion: "2.1",
  userId: ACCOUNT_USER.uid,
  lastUpdated: "2026-01-01T00:00:00.000Z",
  preferences: { ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" },
  goals: { "2026": { sports: { cycling: goals("cycling"), running: goals("running") } } },
  annotations: { "2026": { annotations: [] } },
};

// What each consumer saw, by name.
let prefs: Record<string, ReturnType<typeof usePreferences>> = {};
let seen: Record<string, ReturnType<typeof useGoals>> = {};

function Prefs({ name }: { name: string }) {
  const config = usePreferences();
  useEffect(() => {
    prefs[name] = config;
  });
  return null;
}

function Goals({
  name,
  sport,
  suggested,
}: {
  name: string;
  sport: string;
  suggested?: GoalsForYear;
}) {
  const config = useGoals(2026, sport, suggested);
  useEffect(() => {
    seen[name] = config;
  });
  return null;
}

function OtherReaders() {
  useAnnotations(2026);
  useAllGoals();
  return null;
}

/** Several consumers of several sections, as the app mounts them. */
function Consumers() {
  return (
    <>
      <Prefs name="prefsA" />
      <Prefs name="prefsB" />
      <Goals name="cycling" sport="cycling" />
      <Goals name="running" sport="running" suggested={goals("default")} />
      <Goals name="yoga" sport="yoga" suggested={goals("default")} />
      <OtherReaders />
    </>
  );
}

function renderStore(db: MockDatabaseService) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = new MockAuthService(ACCOUNT_USER);
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TestServiceProvider authService={auth} databaseService={db}>
          <AuthProvider>
            <UserConfigProvider>
              <Consumers />
            </UserConfigProvider>
          </AuthProvider>
        </TestServiceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  return { queryClient, auth };
}

const loaded = () => waitFor(() => expect(seen.cycling?.loading).toBe(false));

describe("UserConfigProvider", () => {
  let db: MockDatabaseService;

  beforeEach(() => {
    prefs = {};
    seen = {};
    db = new MockDatabaseService();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps one listener for the session, however many consumers read it", async () => {
    db.setMockData(PATH, STORED);
    const listeners = vi.spyOn(db, "subscribeToDocument");
    renderStore(db);
    await loaded();

    expect(listeners).toHaveBeenCalledTimes(1);
    expect(seen.cycling!.goalsForYear).toEqual(goals("cycling"));
    expect(prefs.prefsA!.preferences.distanceUnit).toBe("kilometers");
  });

  it("takes each snapshot once, parsed by the one listener, for every section", async () => {
    db.setMockData(PATH, STORED);
    const deliveries = vi.fn();
    const subscribe = db.subscribeToDocument.bind(db);
    const listeners = vi
      .spyOn(db, "subscribeToDocument")
      .mockImplementation((path, onData, onError, options) =>
        subscribe(
          path,
          (data) => {
            deliveries();
            onData(data);
          },
          onError,
          options
        )
      );
    renderStore(db);
    await loaded();
    deliveries.mockClear();

    act(() =>
      db.setMockData(PATH, {
        ...STORED,
        goals: { "2026": { sports: { ...STORED.goals["2026"].sports, cycling: goals("new") } } },
      })
    );

    await waitFor(() => expect(seen.cycling!.goalsForYear).toEqual(goals("new")));
    expect(deliveries).toHaveBeenCalledTimes(1);
    // The listener validates what it delivers.
    expect(listeners.mock.calls[0]![3]).toEqual({ schema: UserConfigSchema });
  });

  describe("when the listener fails", () => {
    it("keeps the last good copy and reports the error, never nothing saved", async () => {
      db.setMockData(PATH, STORED);
      renderStore(db);
      await loaded();

      act(() => db.failListeners(PATH, new Error("offline")));

      await waitFor(() => expect(seen.cycling!.error).toBeInstanceOf(Error));
      expect(seen.cycling!.goalsForYear).toEqual(goals("cycling"));
      expect(seen.cycling!.isSaved).toBe(true);
      expect(prefs.prefsA!.preferences.distanceUnit).toBe("kilometers");
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent("may be out of date");
    });

    it("says so once while it keeps failing, and again only after it has recovered", async () => {
      // A document that stays malformed fails on every change to it.
      db.setMockData(PATH, STORED);
      renderStore(db);
      await loaded();

      act(() => db.failListeners(PATH, new Error("a snapshot didn't validate")));
      act(() => db.failListeners(PATH, new Error("a snapshot didn't validate")));
      await waitFor(() => expect(seen.cycling!.error).not.toBeNull());
      expect(screen.getAllByRole("alert")).toHaveLength(1);

      act(() => db.setMockData(PATH, STORED));
      await waitFor(() => expect(seen.cycling!.error).toBeNull());
      act(() => db.failListeners(PATH, new Error("offline")));
      await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
    });

    it("clears the error with the next good snapshot", async () => {
      db.setMockData(PATH, STORED);
      renderStore(db);
      await loaded();
      act(() => db.failListeners(PATH, new Error("a snapshot didn't validate")));
      await waitFor(() => expect(seen.cycling!.error).not.toBeNull());

      act(() => db.setMockData(PATH, STORED));

      await waitFor(() => expect(seen.cycling!.error).toBeNull());
    });

    it("reports a first load that failed as an error, with nothing known to be saved", async () => {
      vi.spyOn(db, "subscribeToDocument").mockImplementation((_path, _onData, onError) => {
        onError?.(new Error("permission-denied"));
        return () => {};
      });
      renderStore(db);

      await waitFor(() => expect(seen.running?.loading).toBe(false));
      expect(seen.running!.error).toBeInstanceOf(Error);
      expect(seen.running!.isSaved).toBe(false);
      // The default stands in, and isSaved and the error say it isn't what's saved.
      expect(seen.running!.goalsForYear).toEqual(goals("default"));
    });
  });

  it("rolls back only the section whose save failed", async () => {
    db.setMockData(PATH, STORED);
    const write = db.setDocument.bind(db);
    vi.spyOn(db, "setDocument").mockImplementation((path, data, options) =>
      (data as { goals?: unknown }).goals
        ? Promise.reject(new Error("goals refused"))
        : write(path, data, options)
    );
    renderStore(db);
    await loaded();

    const newPrefs = { ...DEFAULT_PREFERENCES, distanceUnit: "miles", timezone: "Europe/Paris" };
    await act(async () => {
      await Promise.allSettled([
        prefs.prefsA!.save(newPrefs),
        seen.cycling!.save(goals("refused")),
      ]);
    });

    await waitFor(() => expect(seen.cycling!.saveError).toBeInstanceOf(Error));
    expect(seen.cycling!.goalsForYear).toEqual(goals("cycling"));
    expect(prefs.prefsB!.preferences.timezone).toBe("Europe/Paris");
  });

  it("drops the account's copy when it signs out, for the next session to start from its own", async () => {
    db.setMockData(PATH, STORED);
    const { queryClient, auth } = renderStore(db);
    await loaded();
    expect(queryClient.getQueryData(configQueryKey(ACCOUNT_USER.uid))).toBeDefined();

    await act(() => auth.signOut());

    await waitFor(() =>
      expect(queryClient.getQueryData(configQueryKey(ACCOUNT_USER.uid))).toBeUndefined()
    );
    // The demo's session reads its own storage, with none of the account's in it.
    await waitFor(() => expect(seen.cycling!.loading).toBe(false));
    expect(seen.cycling!.goalsForYear).toBeNull();
    expect(prefs.prefsA!.preferences.distanceUnit).toBe(DEFAULT_PREFERENCES.distanceUnit);
  });

  it("serves a save to every consumer of that section at once", async () => {
    db.setMockData(PATH, STORED);
    renderStore(db);
    await loaded();

    await act(() => prefs.prefsA!.save({ ...DEFAULT_PREFERENCES, timezone: "Asia/Tokyo" }));

    await waitFor(() => expect(prefs.prefsB!.preferences.timezone).toBe("Asia/Tokyo"));
    expect(prefs.prefsA!.preferences.timezone).toBe("Asia/Tokyo");
  });
});
