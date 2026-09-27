import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUserConfig } from "./useUserConfig";
import { TestServiceProvider } from "../contexts/ServiceContext";
import { AuthProvider } from "../contexts/AuthContext";
import { ToastProvider } from "../contexts/ToastContext";
import { MockAuthService } from "../services/auth/MockAuthService";
import { MockDatabaseService } from "../services/database/MockDatabaseService";
import { UserConfigService, type GoalsForYear } from "../services/userConfigService";
import { DEFAULT_PREFERENCES } from "../constants/settings";

/**
 * The demo → Firestore sign-in migration, end to end: the real hook and service over the
 * in-memory database, signing in from demo mode with demo data in localStorage. The hook's
 * own unit tests mock the service; these catch what only shows with the real subscription
 * (it reports an empty document at once) and several consumers mounted together, as on the
 * dashboard.
 */

const UID = "test-user-123";
const PATH = `users/${UID}/config/v1`;
const DEMO_GOALS_KEY = "userConfig_anonymous_goals_2026_cycling";
const DEMO_PREFS_KEY = "userConfig_anonymous_preferences";

const goal = (id: string, value: number) => ({
  id,
  value,
  label: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  metric: "distance_meters",
});
const DEMO_GOALS: GoalsForYear = { goals: [goal("demo", 5_000_000)], storageVersion: 2 };
/** What a consumer like the sport page passes as its default: generated goals. */
const DEFAULT_GOALS: GoalsForYear = { goals: [goal("generated", 1_000_000)], storageVersion: 2 };

function GoalsConsumer({ withDefault }: { withDefault: boolean }) {
  useUserConfig("goals", 2026, "cycling", withDefault ? DEFAULT_GOALS : undefined);
  return null;
}
function PrefsConsumer({ withDefault }: { withDefault: boolean }) {
  useUserConfig("preferences", undefined, undefined, withDefault ? DEFAULT_PREFERENCES : undefined);
  return null;
}

/**
 * The database as Firestore behaves over a network: reads and writes answer a moment later,
 * while the subscription reports at once, as `onSnapshot` can from its cache. With an
 * instant database the first consumer's migration finishes before the next consumer looks,
 * which hides both bugs.
 */
class NetworkDatabase extends MockDatabaseService {
  override async getDocument<T>(path: string): Promise<T | null> {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return super.getDocument<T>(path);
  }
  override async setDocument<T>(...args: Parameters<MockDatabaseService["setDocument"]>) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return super.setDocument<T>(...(args as [string, T]));
  }
}

const USER = { uid: UID, email: "a@b.com", displayName: "Test", photoURL: null };

/**
 * Two ways a user arrives signed in: back from the Strava redirect, with the app mounting
 * already signed in (the usual one), or signing in while the page is mounted.
 */
const ARRIVALS = ["returning signed in", "signing in on the page"] as const;
type Arrival = (typeof ARRIVALS)[number];

async function renderAs(
  arrival: Arrival,
  children: React.ReactNode,
  db: MockDatabaseService = new NetworkDatabase()
) {
  const auth = new MockAuthService(arrival === "returning signed in" ? USER : null);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ToastProvider>
        <TestServiceProvider authService={auth} databaseService={db}>
          <AuthProvider>{children}</AuthProvider>
        </TestServiceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
  if (arrival === "signing in on the page") await act(() => auth.signIn());
  return { auth, db };
}

const settle = async () => {
  for (let tick = 0; tick < 5; tick++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
};
const stored = (db: MockDatabaseService) =>
  db.getDocument<{
    goals?: Record<string, { sports: Record<string, GoalsForYear> }>;
    preferences?: Record<string, unknown>;
  }>(PATH);

describe("sign-in migration of demo data", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it.each(ARRIVALS)(
    "keeps a new user's demo goals when the consumer passes a default, %s",
    async (arrival) => {
      localStorage.setItem(DEMO_GOALS_KEY, JSON.stringify(DEMO_GOALS));
      const { db } = await renderAs(arrival, <GoalsConsumer withDefault />);

      await waitFor(async () =>
        expect((await stored(db))?.goals?.["2026"]?.sports.cycling?.goals).toEqual(DEMO_GOALS.goals)
      );
      expect(localStorage.getItem(DEMO_GOALS_KEY)).toBeNull();
    }
  );

  it.each(ARRIVALS)(
    "keeps a new user's demo preferences when the consumer passes the defaults, %s",
    async (arrival) => {
      localStorage.setItem(
        DEMO_PREFS_KEY,
        JSON.stringify({ ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" })
      );
      const { db } = await renderAs(arrival, <PrefsConsumer withDefault />);

      await waitFor(async () =>
        expect((await stored(db))?.preferences?.distanceUnit).toBe("kilometers")
      );
      expect(localStorage.getItem(DEMO_PREFS_KEY)).toBeNull();
    }
  );

  it("drops the demo entry, and writes nothing, when the account already has that section", async () => {
    const db = new NetworkDatabase();
    const existing = { goals: [goal("remote", 9_000_000)], storageVersion: 2 };
    db.setMockData(PATH, {
      schemaVersion: "2.1",
      userId: UID,
      lastUpdated: "2026-01-01T00:00:00.000Z",
      goals: { "2026": { sports: { cycling: existing } } },
    });
    localStorage.setItem(DEMO_GOALS_KEY, JSON.stringify(DEMO_GOALS));
    const saves = vi.spyOn(UserConfigService.prototype, "updateConfigSection");
    await renderAs("returning signed in", <GoalsConsumer withDefault />, db);

    await waitFor(() => expect(localStorage.getItem(DEMO_GOALS_KEY)).toBeNull());
    await settle();
    expect(saves).not.toHaveBeenCalled();
    expect((await stored(db))?.goals?.["2026"]?.sports.cycling?.goals).toEqual(existing.goals);
  });

  it.each(ARRIVALS)("migrates once however many consumers are mounted, %s", async (arrival) => {
    localStorage.setItem(DEMO_GOALS_KEY, JSON.stringify(DEMO_GOALS));
    localStorage.setItem(
      DEMO_PREFS_KEY,
      JSON.stringify({ ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" })
    );
    const saves = vi.spyOn(UserConfigService.prototype, "updateConfigSection");
    const { db } = await renderAs(
      arrival,
      <>
        <GoalsConsumer withDefault />
        <GoalsConsumer withDefault={false} />
        <GoalsConsumer withDefault={false} />
        <PrefsConsumer withDefault />
        <PrefsConsumer withDefault={false} />
        <PrefsConsumer withDefault={false} />
      </>
    );
    await waitFor(() => expect(localStorage.getItem(DEMO_GOALS_KEY)).toBeNull());
    await waitFor(() => expect(localStorage.getItem(DEMO_PREFS_KEY)).toBeNull());
    await settle();

    expect(saves.mock.calls.map(([section]) => section).sort()).toEqual(["goals", "preferences"]);
    expect((await stored(db))?.preferences?.distanceUnit).toBe("kilometers");
    expect((await stored(db))?.goals?.["2026"]?.sports.cycling?.goals).toEqual(DEMO_GOALS.goals);
  });

  it("leaves the demo entry for the next load, without retrying, when the save fails", async () => {
    localStorage.setItem(DEMO_GOALS_KEY, JSON.stringify(DEMO_GOALS));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const saves = vi
      .spyOn(UserConfigService.prototype, "updateConfigSection")
      .mockRejectedValue(new Error("offline"));
    await renderAs(
      "returning signed in",
      <>
        <GoalsConsumer withDefault />
        <GoalsConsumer withDefault={false} />
      </>
    );
    await waitFor(() => expect(saves).toHaveBeenCalled());
    for (let round = 0; round < 4; round++) await settle();

    expect(saves).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(DEMO_GOALS_KEY)).not.toBeNull();
  });
});
