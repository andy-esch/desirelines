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
import { demoConfigKey } from "../services/demoStorage";
import { UserConfigService } from "../services/userConfigService";
import {
  DEFAULT_THEME_PREFERENCE,
  SIGNED_IN_HINT_KEY,
  THEME_STORAGE_KEYS,
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
  demo,
  cached,
  prepare,
}: {
  user?: User | null;
  stored?: object;
  /** The demo's own theme on this device. */
  demo?: ThemePreference;
  /** The account's cached theme, with the signed-in hint, as a returning visitor has. */
  cached?: ThemePreference;
  prepare?: (db: MockDatabaseService) => void;
}) {
  if (demo) localStorage.setItem(THEME_STORAGE_KEYS.demo, demo);
  if (cached) {
    localStorage.setItem(THEME_STORAGE_KEYS.account, cached);
    localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
  }
  const auth = new MockAuthService(user);
  const db = new MockDatabaseService();
  if (stored) db.setMockData(PATH, stored);
  prepare?.(db);
  const writes = vi.spyOn(db, "setDocument");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const theme: { current: ReturnType<typeof useTheme> | null } = { current: null };
  const shown: (ThemePreference | undefined)[] = [];
  function Probe() {
    theme.current = useTheme();
    shown.push(theme.current.preference);
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
    shown,
    preference: () => theme.current?.preference,
    scope: () => theme.current?.scope,
    choose: (next: ThemePreference) => act(() => theme.current?.setPreference(next)),
  };
}

const settle = async () => {
  for (let tick = 0; tick < 5; tick++) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
};

describe("ThemeSync", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  describe("signed out (demo mode)", () => {
    it("shows and saves the demo's own theme, neither reading nor writing the account's", async () => {
      // Demo preferences live in localStorage; a theme there must not be applied either.
      localStorage.setItem(
        demoConfigKey("preferences"),
        JSON.stringify({ ...DEFAULT_PREFERENCES, theme: "arcade" })
      );
      const themeWrites = vi.spyOn(UserConfigService.prototype, "updateTheme");
      const sync = renderSync({ user: null, stored: storedConfig("arcade"), demo: "legacy-light" });
      await settle();
      expect(sync.preference()).toBe("legacy-light");
      sync.choose("system");
      await settle();

      expect(sync.scope()).toBe("demo");
      expect(localStorage.getItem(THEME_STORAGE_KEYS.demo)).toBe("system");
      expect(localStorage.getItem(THEME_STORAGE_KEYS.account)).toBeNull();
      expect(themeWrites).not.toHaveBeenCalled();
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("shows the demo's theme again on sign-out, and forgets the account's", async () => {
      const sync = renderSync({ stored: storedConfig("arcade"), demo: "legacy-light" });
      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      await act(() => sync.auth.signOut());
      await settle();

      expect(sync.scope()).toBe("demo");
      expect(sync.preference()).toBe("legacy-light");
      expect(localStorage.getItem(SIGNED_IN_HINT_KEY)).toBeNull();
      expect(localStorage.getItem(THEME_STORAGE_KEYS.account)).toBeNull();
      sync.choose("miami");
      await settle();
      expect(sync.writes).not.toHaveBeenCalled();
      expect((await storedPreferences(sync.db))?.theme).toBe("arcade");
    });
  });

  describe("on sign-in", () => {
    it("shows the account's synced theme, without writing, and leaves the demo's alone", async () => {
      const sync = renderSync({ stored: storedConfig("arcade"), demo: "legacy-light" });

      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      expect(sync.scope()).toBe("account");
      expect(localStorage.getItem(THEME_STORAGE_KEYS.account)).toBe("arcade");
      expect(localStorage.getItem(THEME_STORAGE_KEYS.demo)).toBe("legacy-light");
      await settle();
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("goes straight from the demo's theme to the account's when signing in on the page", async () => {
      const sync = renderSync({ user: null, stored: storedConfig("arcade"), demo: "legacy-light" });
      await settle();
      await act(() => sync.auth.signIn());

      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      await settle();
      // No stop at the default on the way.
      expect(new Set(sync.shown)).toEqual(new Set(["legacy-light", "arcade"]));
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("starts a returning user on the cached theme, then the synced one", async () => {
      const sync = renderSync({
        stored: storedConfig("arcade"),
        demo: "miami",
        cached: "legacy-light",
      });

      expect(sync.shown[0]).toBe("legacy-light");
      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      await settle();
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("starts a new account at the default theme, writing nothing from this device", async () => {
      const sync = renderSync({ demo: "arcade" });
      await settle();

      expect(sync.scope()).toBe("account");
      expect(sync.preference()).toBe(DEFAULT_THEME_PREFERENCE);
      expect(sync.writes).not.toHaveBeenCalled();
      expect(await sync.db.getDocument(PATH)).toBeNull();
      expect(localStorage.getItem(THEME_STORAGE_KEYS.demo)).toBe("arcade");
    });

    it("imports nothing from the demo's preferences or theme when a new user signs in", async () => {
      const demoPreferences = JSON.stringify({
        ...DEFAULT_PREFERENCES,
        distanceUnit: "kilometers",
      });
      localStorage.setItem(demoConfigKey("preferences"), demoPreferences);
      const sync = renderSync({ user: null, demo: "arcade" });
      await settle();
      await act(() => sync.auth.signIn());
      await settle();

      expect(sync.preference()).toBe(DEFAULT_THEME_PREFERENCE);
      expect(await sync.db.getDocument(PATH)).toBeNull();
      expect(localStorage.getItem(demoConfigKey("preferences"))).toBe(demoPreferences);
      expect(localStorage.getItem(THEME_STORAGE_KEYS.demo)).toBe("arcade");
    });

    it.each(["", "dark", "light"])(
      "reads a synced %j as no choice: shows the default and writes nothing",
      async (unset) => {
        const sync = renderSync({ stored: storedConfig(unset), demo: "legacy-light" });
        await settle();

        expect(sync.preference()).toBe(DEFAULT_THEME_PREFERENCE);
        expect(sync.writes).not.toHaveBeenCalled();
        expect(await storedPreferences(sync.db)).toEqual(storedConfig(unset).preferences);
      }
    );
  });

  describe("signed in", () => {
    it("writes a change made here, and only the theme", async () => {
      const sync = renderSync({ stored: storedConfig("arcade") });
      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      sync.choose("system");

      await waitFor(async () =>
        expect(await storedPreferences(sync.db)).toEqual(storedConfig("system").preferences)
      );
      expect(sync.writes).toHaveBeenCalledTimes(1);
      expect(sync.writes.mock.calls[0]?.[1]).toMatchObject({ preferences: { theme: "system" } });
      expect(
        Object.keys((sync.writes.mock.calls[0]?.[1] as { preferences: object }).preferences)
      ).toEqual(["theme"]);
      expect(localStorage.getItem(THEME_STORAGE_KEYS.account)).toBe("system");
    });

    it("writes the first choice made for an account with no theme", async () => {
      const sync = renderSync({});
      await settle();
      sync.choose("arcade");

      await waitFor(async () => expect((await storedPreferences(sync.db))?.theme).toBe("arcade"));
      // The document is new, so the write carries what the rules require of one.
      expect(await sync.db.getDocument(PATH)).toMatchObject({
        schemaVersion: expect.any(String),
        userId: USER.uid,
        lastUpdated: expect.any(String),
      });
      expect(sync.writes).toHaveBeenCalledTimes(1);
    });

    it("keeps the synced theme when an unrelated preference is saved over defaults", async () => {
      // What the settings page and sport visibility save: the defaults, then the change.
      const sync = renderSync({ stored: storedConfig("arcade") });
      await waitFor(() => expect(sync.preference()).toBe("arcade"));
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
      const sync = renderSync({ stored: storedConfig("arcade") });
      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      act(() => sync.db.setMockData(PATH, storedConfig("system")));

      await waitFor(() => expect(sync.preference()).toBe("system"));
      await settle();
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("restores the account's theme when an older client's save leaves it unset", async () => {
      // A preferences save from a client that still spreads a "dark" default.
      const sync = renderSync({ stored: storedConfig("arcade") });
      await waitFor(() => expect(sync.preference()).toBe("arcade"));
      act(() => sync.db.setMockData(PATH, storedConfig("dark")));

      await waitFor(async () => expect((await storedPreferences(sync.db))?.theme).toBe("arcade"));
      expect(sync.preference()).toBe("arcade");
    });

    it("falls back to the default for a synced theme it doesn't know, without overwriting it", async () => {
      // Another device may run a newer build with a theme this one hasn't got.
      const sync = renderSync({ stored: storedConfig("neon"), cached: "arcade" });

      await waitFor(() => expect(sync.preference()).toBe(DEFAULT_THEME_PREFERENCE));
      await settle();
      expect(sync.writes).not.toHaveBeenCalled();
    });

    it("shows the account's cached theme, and writes nothing, while the first read has failed", async () => {
      // Writing on a failed read would take "nothing synced" on faith and could overwrite the
      // choice another device made.
      vi.spyOn(console, "error").mockImplementation(() => {});
      const sync = renderSync({
        stored: storedConfig("arcade"),
        demo: "legacy-light",
        cached: "system",
        prepare: (db) => {
          vi.spyOn(db, "getDocument").mockRejectedValue(new Error("offline"));
          vi.spyOn(db, "subscribeToDocument").mockReturnValue(() => {});
        },
      });
      await settle();

      expect(sync.scope()).toBe("account");
      expect(sync.preference()).toBe("system");
      expect(sync.writes).not.toHaveBeenCalled();
    });
  });
});
