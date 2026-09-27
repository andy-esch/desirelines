import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserConfigProvider } from "./UserConfigProvider";
import { TestServiceProvider } from "./ServiceContext";
import { AuthProvider } from "./AuthContext";
import { ToastProvider } from "./ToastContext";
import { useUserConfig, useFullUserConfig } from "../hooks/useUserConfig";
import { MockAuthService } from "../services/auth/MockAuthService";
import { MockDatabaseService } from "../services/database/MockDatabaseService";
import {
  UserConfigSchema,
  type GoalsForYear,
  type Preferences,
} from "../services/userConfigService";
import { DEFAULT_PREFERENCES } from "../constants/settings";
import { ACCOUNT_CONFIG_PATH as PATH, ACCOUNT_USER, storedGoal } from "../test/fixtures/userConfig";
import useUserConfigSource from "../hooks/useUserConfig.ts?raw";

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

/** What a consumer saw; any section's save goes through `updateData`. */
type Seen = ReturnType<typeof useUserConfig> & {
  updateData: (data: GoalsForYear | Preferences) => Promise<void>;
};
let seen: Record<string, Seen> = {};

/** Reads one section and reports what the hook returns, under `name`. */
function Section({
  name,
  args,
}: {
  name: string;
  args: [
    configType: "goals" | "annotations" | "preferences",
    year?: number | undefined,
    sport?: string | undefined,
    defaultValue?: GoalsForYear | Preferences,
  ];
}) {
  const config = (useUserConfig as (...a: unknown[]) => Seen)(...args);
  useEffect(() => {
    seen[name] = config;
  });
  return null;
}

function FullConfig() {
  useFullUserConfig();
  return null;
}

/** Several consumers of several sections, as the app mounts them. */
function Consumers() {
  return (
    <>
      <Section name="prefsA" args={["preferences"]} />
      <Section name="prefsB" args={["preferences"]} />
      <Section name="prefsC" args={["preferences", undefined, undefined, DEFAULT_PREFERENCES]} />
      <Section name="cycling" args={["goals", 2026, "cycling"]} />
      <Section name="running" args={["goals", 2026, "running", goals("default")]} />
      <Section name="yoga" args={["goals", 2026, "yoga", goals("default")]} />
      <Section name="notes" args={["annotations", 2026]} />
      <FullConfig />
    </>
  );
}

function renderStore(db: MockDatabaseService) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <TestServiceProvider authService={new MockAuthService(ACCOUNT_USER)} databaseService={db}>
          <AuthProvider>
            <UserConfigProvider>
              <Consumers />
            </UserConfigProvider>
          </AuthProvider>
        </TestServiceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const loaded = () => waitFor(() => expect(seen.cycling?.loading).toBe(false));

describe("UserConfigProvider", () => {
  let db: MockDatabaseService;

  beforeEach(() => {
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
    expect(seen.cycling!.data).toEqual(goals("cycling"));
    expect(seen.prefsA!.data?.distanceUnit).toBe("kilometers");
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

    await waitFor(() => expect(seen.cycling!.data).toEqual(goals("new")));
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
      expect(seen.cycling!.data).toEqual(goals("cycling"));
      expect(seen.cycling!.isSaved).toBe(true);
      expect(seen.prefsA!.data?.distanceUnit).toBe("kilometers");
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent("may be out of date");
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
      expect(seen.running!.data).toEqual(goals("default"));
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
        seen.prefsA!.updateData(newPrefs),
        seen.cycling!.updateData(goals("refused")),
      ]);
    });

    await waitFor(() => expect(seen.cycling!.saveError).toBeInstanceOf(Error));
    expect(seen.cycling!.data).toEqual(goals("cycling"));
    expect(seen.prefsB!.data?.timezone).toBe("Europe/Paris");
  });

  it("serves a save to every consumer of that section at once", async () => {
    db.setMockData(PATH, STORED);
    renderStore(db);
    await loaded();

    await act(() => seen.prefsA!.updateData({ ...DEFAULT_PREFERENCES, timezone: "Asia/Tokyo" }));

    await waitFor(() => expect(seen.prefsC!.data?.timezone).toBe("Asia/Tokyo"));
    expect(seen.prefsB!.data?.timezone).toBe("Asia/Tokyo");
  });
});

describe("useUserConfig", () => {
  it("has no storage branches of its own: the store's adapters hold both sides", () => {
    expect(useUserConfigSource).not.toMatch(
      /\blocalStorage\.|from "\.\.\/services\/demoStorage"|new UserConfigService/
    );
  });
});
