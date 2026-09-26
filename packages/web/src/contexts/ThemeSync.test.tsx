import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeSync } from "./ThemeSync";
import { ThemeProvider, useTheme } from "./ThemeContext";
import { ToastProvider } from "./ToastContext";
import { TestServiceProvider } from "./ServiceContext";
import { AuthProvider } from "./AuthContext";
import { MockAuthService } from "../services/auth/MockAuthService";
import { MockDatabaseService } from "../services/database/MockDatabaseService";
import { DEFAULT_PREFERENCES } from "../constants/settings";
import { UserConfigService } from "../services/userConfigService";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../themes/registry";
import type { User } from "../services/auth/AuthService";

const USER: User = {
  uid: "test-user-123",
  email: "test@example.com",
  displayName: "Test User",
  photoURL: null,
};
const PATH = `users/${USER.uid}/config/v1`;

/** A stored config whose preferences are all set, so a write that drops one shows. */
function storedConfig(theme: string) {
  return {
    schemaVersion: "2.1",
    userId: USER.uid,
    lastUpdated: "2026-01-01T00:00:00.000Z",
    preferences: {
      ...DEFAULT_PREFERENCES,
      theme,
      distanceUnit: "kilometers",
      timezone: "Europe/Paris",
      visibleSports: ["running"],
    },
  };
}

function storedPreferences(db: MockDatabaseService) {
  return db
    .getDocument<ReturnType<typeof storedConfig>>(PATH)
    .then((config) => config?.preferences);
}

function renderSync({
  user = USER,
  stored,
  local,
  prepare,
}: {
  user?: User | null;
  stored?: object;
  local: ThemePreference;
  prepare?: (db: MockDatabaseService) => void;
}) {
  localStorage.setItem(THEME_STORAGE_KEY, local);
  const auth = new MockAuthService(user);
  const db = new MockDatabaseService();
  if (stored) db.setMockData(PATH, stored);
  prepare?.(db);
  const writes = vi.spyOn(db, "setDocument");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const theme: { current: ReturnType<typeof useTheme> | null } = { current: null };
  function Probe() {
    theme.current = useTheme();
    return null;
  }

  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ToastProvider>
          <TestServiceProvider authService={auth} databaseService={db}>
            <AuthProvider>
              <ThemeSync />
              <Probe />
            </AuthProvider>
          </TestServiceProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );

  return {
    auth,
    db,
    writes,
    preference: () => theme.current?.preference,
    choose: (next: ThemePreference) => act(() => theme.current?.setPreference(next)),
  };
}

/** Let the query, the subscription and any write settle. */
const settle = async () => {
  for (let tick = 0; tick < 5; tick++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
};

describe("ThemeSync", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  describe("signed out (demo mode)", () => {
    it("neither reads nor writes the synced theme", async () => {
      // Demo preferences live in localStorage; a theme there must not be applied either.
      localStorage.setItem(
        "userConfig_anonymous_preferences",
        JSON.stringify({ ...DEFAULT_PREFERENCES, theme: "arcade" })
      );
      const themeWrites = vi.spyOn(UserConfigService.prototype, "updateTheme");
      const sync = renderSync({
        user: null,
        stored: storedConfig("arcade"),
        local: "legacy-light",
      });
      await settle();
      expect(sync.preference()).toBe("legacy-light");
      sync.choose("system");
      await settle();

      expect(sync.preference()).toBe("system");
      expect(themeWrites).not.toHaveBeenCalled();
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("stops syncing on sign-out", async () => {
      const sync = renderSync({ stored: storedConfig("arcade"), local: "arcade" });
      await settle();
      await act(() => sync.auth.signOut());
      sync.choose("legacy-light");
      await settle();

      expect(sync.writes).not.toHaveBeenCalled();
      expect((await storedPreferences(sync.db))?.theme).toBe("arcade");
    });
  });

  describe("on sign-in", () => {
    it("applies a synced theme here, without writing", async () => {
      const sync = renderSync({ stored: storedConfig("arcade"), local: "legacy-light" });

      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("arcade");
      await settle();
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("applies a theme synced once signed in", async () => {
      const sync = renderSync({
        user: null,
        stored: storedConfig("arcade"),
        local: "legacy-light",
      });
      await settle();
      await act(() => sync.auth.signIn());

      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      await settle();
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("applies the synced theme again on signing back in, over a choice made signed out", async () => {
      const sync = renderSync({ stored: storedConfig("arcade"), local: "arcade" });
      await settle();
      await act(() => sync.auth.signOut());
      sync.choose("legacy-light");
      await settle();
      await act(() => sync.auth.signIn());

      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      await settle();
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("writes this device's theme when there's no config yet", async () => {
      const sync = renderSync({ local: "legacy-light" });

      await waitFor(async () =>
        expect((await storedPreferences(sync.db))?.theme).toBe("legacy-light")
      );
      // The document is new, so the write carries what the rules require of one.
      expect(await sync.db.getDocument(PATH)).toMatchObject({
        schemaVersion: expect.any(String),
        userId: USER.uid,
        lastUpdated: expect.any(String),
      });
      expect(sync.preference()).toBe("legacy-light");
    });

    it("lands both the theme and a new user's migrated demo preferences", async () => {
      // The sign-in migration writes the demo preferences, theme and all, as the theme is
      // written; whichever lands last, both survive.
      localStorage.setItem(
        "userConfig_anonymous_preferences",
        JSON.stringify({ ...DEFAULT_PREFERENCES, theme: "dark", distanceUnit: "kilometers" })
      );
      const sync = renderSync({ user: null, local: "arcade" });
      await settle();
      await act(() => sync.auth.signIn());

      await waitFor(async () =>
        expect(await storedPreferences(sync.db)).toMatchObject({
          theme: "arcade",
          distanceUnit: "kilometers",
        })
      );
      expect(localStorage.getItem("userConfig_anonymous_preferences")).toBeNull();
      expect(sync.preference()).toBe("arcade");
    });

    it.each(["", "dark", "light"])(
      "reads a synced %j as no choice, writing this device's theme and keeping the rest",
      async (unset) => {
        const sync = renderSync({ stored: storedConfig(unset), local: "legacy-light" });

        await waitFor(async () =>
          expect(await storedPreferences(sync.db)).toEqual(storedConfig("legacy-light").preferences)
        );
        expect(sync.preference()).toBe("legacy-light");
      }
    );
  });

  it("writes a change made here, and only the theme", async () => {
    const sync = renderSync({ stored: storedConfig("arcade"), local: "arcade" });
    await settle();
    sync.choose("system");

    await waitFor(async () =>
      expect(await storedPreferences(sync.db)).toEqual(storedConfig("system").preferences)
    );
    expect(sync.writes).toHaveBeenCalledTimes(1);
    expect(sync.writes.mock.calls[0]?.[1]).toMatchObject({ preferences: { theme: "system" } });
    expect(
      Object.keys((sync.writes.mock.calls[0]?.[1] as { preferences: object }).preferences)
    ).toEqual(["theme"]);
  });

  it("keeps the synced theme when an unrelated preference is saved over defaults", async () => {
    // What the settings page and sport visibility save: the defaults, then the change.
    const sync = renderSync({ stored: storedConfig("arcade"), local: "arcade" });
    await settle();
    const service = new UserConfigService(undefined, "v1", {
      authService: sync.auth,
      databaseService: sync.db,
    });
    await act(() =>
      service.updateConfigSection("preferences", {
        ...DEFAULT_PREFERENCES,
        distanceUnit: "kilometers",
      })
    );
    await settle();

    expect(await storedPreferences(sync.db)).toMatchObject({
      theme: "arcade",
      distanceUnit: "kilometers",
    });
    expect(sync.preference()).toBe("arcade");
    expect(sync.writes).toHaveBeenCalledTimes(1);
  });

  it("applies a change from another device and never writes it back", async () => {
    const sync = renderSync({ stored: storedConfig("arcade"), local: "arcade" });
    await settle();
    act(() => sync.db.setMockData(PATH, storedConfig("system")));

    await waitFor(() => expect(sync.preference()).toBe("system"));
    await settle();
    expect(sync.writes).not.toHaveBeenCalled();
  });

  it("keeps this device's theme when another device's save leaves the theme unset", async () => {
    // A preferences save from a client that still spreads a "dark" default.
    const sync = renderSync({ stored: storedConfig("arcade"), local: "arcade" });
    await settle();
    act(() => sync.db.setMockData(PATH, storedConfig("dark")));

    await waitFor(async () => expect((await storedPreferences(sync.db))?.theme).toBe("arcade"));
    expect(sync.preference()).toBe("arcade");
  });

  it("falls back to the default for a synced theme it doesn't know, without overwriting it", async () => {
    // Another device may run a newer build with a theme this one hasn't got.
    const sync = renderSync({ stored: storedConfig("neon"), local: "arcade" });

    await waitFor(() => expect(sync.preference()).toBe(DEFAULT_THEME_PREFERENCE));
    await settle();
    expect(sync.writes).not.toHaveBeenCalled();
  });

  it("doesn't write while the first read has failed and nothing else has arrived", async () => {
    // Writing on a failed read would take "nothing synced" on faith and could overwrite the
    // choice another device made.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sync = renderSync({
      stored: storedConfig("arcade"),
      local: "legacy-light",
      prepare: (db) => {
        vi.spyOn(db, "getDocument").mockRejectedValue(new Error("offline"));
        vi.spyOn(db, "subscribeToDocument").mockReturnValue(() => {});
      },
    });
    await settle();

    expect(sync.writes).not.toHaveBeenCalled();
    expect(sync.preference()).toBe("legacy-light");
  });
});
