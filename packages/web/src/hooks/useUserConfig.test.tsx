import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useUserConfig, useFullUserConfig } from "./useUserConfig";
import { UserConfigService, parseConfigData } from "../services/userConfigService";
import type { GoalsForYear, UserConfig } from "../services/userConfigService";
import { TestServiceProvider } from "../contexts/ServiceContext";
import { UserConfigProvider } from "../contexts/UserConfigProvider";
import { demoConfigKey } from "../services/demoStorage";
import { configQueryKey } from "../services/config/configAdapter";
import { withSection } from "../services/config/sections";
import { DEFAULT_PREFERENCES } from "../constants/settings";

// Mock UserConfigService and parseConfigData. parseConfigData defaults to an
// identity-passing validator since most tests pass already-shaped fixtures;
// individual tests can call `vi.mocked(parseConfigData).mockReturnValueOnce`
// to drive the failure path.
vi.mock("../services/userConfigService", () => {
  const MockUserConfigService = vi.fn();
  MockUserConfigService.prototype.getConfigSection = vi.fn();
  MockUserConfigService.prototype.updateConfigSection = vi.fn();
  MockUserConfigService.prototype.getConfig = vi.fn();
  MockUserConfigService.prototype.subscribeToConfig = vi.fn(() => vi.fn());
  // Identity-passing schema validator — tests pass already-shaped fixtures,
  // so we don't need to exercise the real Zod schema here. Individual tests
  // can call `vi.mocked(parseConfigData).mockReturnValueOnce` to drive the
  // failure path.
  const parseConfigData = vi.fn((_configType: string, data: unknown) => ({
    ok: true as const,
    data: data as object,
  }));
  return { UserConfigService: MockUserConfigService, parseConfigData };
});

const mockedParseConfigData = vi.mocked(parseConfigData);

// Mock useAuth with dynamic return value
const mockUser = { uid: "test-user", email: "test@example.com", displayName: "Test User" };
let mockAuthState = { user: mockUser as any, loading: false };

vi.mock("./useAuth", () => ({
  useAuth: () => mockAuthState,
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    // The demo store gathers its sections by walking the keys.
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        // Ensure garbage collection doesn't mess up tests
        gcTime: Infinity,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <TestServiceProvider>
      <QueryClientProvider client={queryClient}>
        <UserConfigProvider>{children}</UserConfigProvider>
      </QueryClientProvider>
    </TestServiceProvider>
  );
};

/**
 * The account's config listener: it sends `doc` as the first snapshot, as Firestore's does,
 * and `report` and `fail` send what comes after.
 */
function serve(doc: UserConfig | null) {
  const listener = {
    report: (_doc: UserConfig | null) => {},
    fail: (_error: Error) => {},
  };
  vi.mocked(UserConfigService.prototype.subscribeToConfig).mockImplementation(
    (onConfig, onError) => {
      listener.report = onConfig;
      listener.fail = onError;
      onConfig(doc);
      return vi.fn();
    }
  );
  return listener;
}

/** A document holding just 2025's cycling goals. */
const goalsDoc = (goals: GoalsForYear) =>
  withSection(null, { section: "goals", year: 2025, sport: "cycling" }, goals);

// Tests give the service's methods their own results; clearAllMocks keeps those, and they
// would leak into every later test. Reset each to what the mock factory made it.
function resetServiceMocks() {
  const proto = UserConfigService.prototype as unknown as Record<string, { mockReset(): void }>;
  for (const method of [
    "getConfigSection",
    "updateConfigSection",
    "getConfig",
    "subscribeToConfig",
  ]) {
    proto[method]!.mockReset();
  }
}

describe("useUserConfig", () => {
  let mockServiceInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceMocks();
    mockServiceInstance = UserConfigService.prototype;
    // Default to authenticated state
    mockAuthState = { user: mockUser, loading: false };
    localStorageMock.clear();
    // Tests override these reads and writes; clearAllMocks keeps an override, and it would
    // leak into every later test. Reset each to the in-memory store it was made with.
    localStorageMock.getItem.mockReset();
    localStorageMock.setItem.mockReset();
    localStorageMock.removeItem.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("overloaded signatures", () => {
    it("should work with 'goals' configType and year parameter", async () => {
      const mockGoals: GoalsForYear = {
        goals: [
          {
            id: "1",
            value: 1000,
            label: "Goal",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            metric: "",
          },
        ],
      };

      serve(goalsDoc(mockGoals));

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.data).toEqual(mockGoals);
    });
  });

  describe("LocalStorage Fallback (Demo Mode)", () => {
    beforeEach(() => {
      mockAuthState = { user: null, loading: false };
    });

    it("should read from localStorage when user is null", async () => {
      const storedGoals = {
        goals: [{ id: "ls", value: 500, label: "LS", createdAt: "", updatedAt: "", metric: "" }],
      };
      localStorageMock.setItem(
        demoConfigKey("goals", 2025, "cycling"),
        JSON.stringify(storedGoals)
      );

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toEqual(storedGoals);
      expect(localStorageMock.getItem).toHaveBeenCalled();
      // Should NOT call service
      expect(mockServiceInstance.getConfigSection).not.toHaveBeenCalled();
      expect(mockServiceInstance.subscribeToConfig).not.toHaveBeenCalled();
    });

    it("should write to localStorage when user is null", async () => {
      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.loading).toBe(false));

      const newGoals: GoalsForYear = {
        goals: [
          {
            id: "new",
            value: 1000,
            label: "New",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            metric: "",
          },
        ],
      };

      // Ensure initial query is fully settled to avoid race condition
      await new Promise((resolve) => setTimeout(resolve, 0));

      await act(async () => {
        await result.current.updateData(newGoals);
      });

      expect(result.current.saveError).toBeNull();
      // Into the demo's own namespace, never an account key.
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        demoConfigKey("goals", 2025, "cycling"),
        JSON.stringify(newGoals)
      );
      // React Query renders the optimistic value a tick after `act`.
      await waitFor(() => expect(result.current.data).toEqual(newGoals));
      expect(mockServiceInstance.updateConfigSection).not.toHaveBeenCalled();
    });

    it("should use caller-supplied default if localStorage is empty", async () => {
      localStorageMock.getItem.mockReturnValue(null);
      const callerDefault: GoalsForYear = {
        goals: [
          {
            id: "d1",
            value: 100,
            label: "Default",
            metric: "distance_meters",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };
      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling", callerDefault), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toEqual(callerDefault);
    });

    it("returns null for goals when localStorage is empty and no default is supplied", async () => {
      localStorageMock.getItem.mockReturnValue(null);
      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
      // In production callers always pass a sport-aware defaultValue.
      // Without one, returning null is the documented behavior — guards the
      // caller's null-handling path.
      expect(result.current.data).toBeNull();
    });

    it("falls back to default when localStorage data fails schema validation", async () => {
      // Demo-mode reads are validated like any stored config: corrupted
      // localStorage shouldn't surface junk to the consumer. parseConfigData
      // rejects the blob → readFromLocalStorage returns the caller default.
      const callerDefault: GoalsForYear = {
        goals: [
          {
            id: "fallback",
            value: 999,
            label: "Fallback",
            metric: "distance_meters",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
      };
      localStorageMock.setItem(demoConfigKey("goals", 2025, "cycling"), '{"goals":"not an array"}');
      mockedParseConfigData.mockReturnValueOnce({
        ok: false,
        error: { issues: [] } as any,
      });

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling", callerDefault), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toEqual(callerDefault);
    });
  });

  describe("isSaved", () => {
    const goals = (id: string): GoalsForYear => ({
      goals: [
        {
          id,
          value: 100,
          label: id,
          metric: "distance_meters",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
      ],
    });

    it.each([
      ["nothing saved", false, null],
      ["goals saved", true, goals("saved")],
    ])("signed in with %s, is %s", async (_, saved, stored) => {
      serve(stored ? goalsDoc(stored) : null);
      const { result } = renderHook(
        () => useUserConfig("goals", 2025, "cycling", goals("default")),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.isSaved).toBe(saved);
      expect(result.current.data).toEqual(stored ?? goals("default"));
    });

    it("is false while loading", () => {
      mockAuthState = { user: mockUser, loading: true };
      const { result } = renderHook(
        () => useUserConfig("goals", 2025, "cycling", goals("default")),
        { wrapper: createWrapper() }
      );
      expect(result.current.isSaved).toBe(false);
    });

    describe("in the demo", () => {
      beforeEach(() => {
        mockAuthState = { user: null, loading: false };
      });

      it.each([
        ["nothing saved", false, null],
        ["goals saved", true, JSON.stringify(goals("saved"))],
      ])("with %s, is %s", async (_, saved, stored) => {
        if (stored) localStorageMock.setItem(demoConfigKey("goals", 2025, "cycling"), stored);
        const { result } = renderHook(
          () => useUserConfig("goals", 2025, "cycling", goals("default")),
          { wrapper: createWrapper() }
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.isSaved).toBe(saved);
      });

      it("is false for a saved section that fails validation, which shows the default", async () => {
        localStorageMock.setItem(
          demoConfigKey("goals", 2025, "cycling"),
          '{"goals":"not an array"}'
        );
        mockedParseConfigData.mockReturnValueOnce({ ok: false, error: { issues: [] } as any });
        const { result } = renderHook(
          () => useUserConfig("goals", 2025, "cycling", goals("default")),
          { wrapper: createWrapper() }
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.isSaved).toBe(false);
        expect(result.current.data).toEqual(goals("default"));
      });

      it("turns true once the default is saved", async () => {
        const { result } = renderHook(
          () => useUserConfig("goals", 2025, "cycling", goals("default")),
          { wrapper: createWrapper() }
        );
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.isSaved).toBe(false);

        await act(() => result.current.updateData(goals("default")));

        await waitFor(() => expect(result.current.isSaved).toBe(true));
      });

      it("shows the caller's current default, not the one it had when first read", async () => {
        // The sport page's suggested goals follow this year's pace, which loads after the
        // goals do. The demo used to cache the first default it was given.
        const { result, rerender } = renderHook(
          ({ fallback }) => useUserConfig("goals", 2025, "cycling", fallback),
          { wrapper: createWrapper(), initialProps: { fallback: goals("early") } }
        );
        await waitFor(() => expect(result.current.data).toEqual(goals("early")));

        rerender({ fallback: goals("paced") });

        expect(result.current.data).toEqual(goals("paced"));
      });

      it("still falls back to the default preferences without a caller default", async () => {
        const { result } = renderHook(() => useUserConfig("preferences"), {
          wrapper: createWrapper(),
        });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).toEqual(DEFAULT_PREFERENCES);
        expect(result.current.isSaved).toBe(false);
      });
    });
  });

  describe("Subscription Lifecycle", () => {
    // The cache holds what Firestore holds; a default cached here would read as stored data
    // to anything that reads the cache.
    it.each([
      ["goals", 2025, "cycling", { goals: [], storageVersion: 2 }],
      ["annotations", 2025, undefined, { annotations: [] }],
      ["preferences", undefined, undefined, { theme: "", distanceUnit: "kilometers" }],
    ] as const)(
      "caches an empty %s report as null and returns the default",
      async (configType, year, sport, defaultValue) => {
        // Report after the first load, as a live listener does, so its value is what's cached.
        const listener = serve(
          withSection(null, { section: "preferences" }, { theme: "x" } as any)
        );
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: React.ReactNode }) => (
          <TestServiceProvider>
            <QueryClientProvider client={queryClient}>
              <UserConfigProvider>{children}</UserConfigProvider>
            </QueryClientProvider>
          </TestServiceProvider>
        );
        const { result } = renderHook(
          () => useUserConfig(configType as any, year as any, sport as any, defaultValue as any),
          { wrapper }
        );

        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => listener.report(null));
        await waitFor(() => expect(result.current.data).toEqual(defaultValue));
        // The one document entry holds what was reported, never the default.
        expect(queryClient.getQueryData(configQueryKey(mockUser.uid))).toBeNull();
      }
    );

    it("should unsubscribe on unmount", async () => {
      const unsubscribeMock = vi.fn();
      mockServiceInstance.subscribeToConfig.mockImplementation((onConfig: any) => {
        onConfig(null);
        return unsubscribeMock;
      });

      const { unmount } = renderHook(() => useUserConfig("goals", 2025, "cycling"), {
        wrapper: createWrapper(),
      });

      // Wait for effect to run
      await waitFor(() => expect(mockServiceInstance.subscribeToConfig).toHaveBeenCalled());

      unmount();
      expect(unsubscribeMock).toHaveBeenCalled();
    });

    it("keeps its one listener when the section it reads changes", async () => {
      // A listener per section used to be torn down and opened again for each new year or
      // sport. The store's one listener serves every section, so nothing is resubscribed.
      const goals2024: GoalsForYear = { goals: [], storageVersion: 2 };
      serve(
        withSection(
          goalsDoc({ goals: [] }),
          { section: "goals", year: 2024, sport: "cycling" },
          goals2024
        )
      );

      const { result, rerender } = renderHook(
        ({ year }) => useUserConfig("goals", year, "cycling"),
        {
          initialProps: { year: 2025 },
          wrapper: createWrapper(),
        }
      );

      await waitFor(() => expect(mockServiceInstance.subscribeToConfig).toHaveBeenCalledTimes(1));

      // Change year
      rerender({ year: 2024 });

      await waitFor(() => expect(result.current.data).toEqual(goals2024));
      expect(mockServiceInstance.subscribeToConfig).toHaveBeenCalledTimes(1);
    });
  });

  describe("optimistic updates", () => {
    it("should update local state immediately when updateData is called", async () => {
      const initialGoals: GoalsForYear = {
        goals: [
          {
            id: "initial",
            value: 500,
            label: "Initial",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            metric: "",
          },
        ],
      };
      const newGoals: GoalsForYear = {
        goals: [
          {
            id: "new",
            value: 1000,
            label: "New",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            metric: "",
          },
        ],
      };

      serve(goalsDoc(initialGoals));
      mockServiceInstance.updateConfigSection.mockResolvedValue(undefined);

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Ensure initial data is settled
      await waitFor(() => expect(result.current.data).toEqual(initialGoals));

      await act(async () => {
        await result.current.updateData(newGoals);
      });

      // Verify mutation called service
      expect(mockServiceInstance.updateConfigSection).toHaveBeenCalledWith(
        "goals",
        newGoals,
        2025,
        "cycling"
      );

      // The optimistic value shows (React Query renders it a tick after `act`) and stays.
      await waitFor(() => expect(result.current.data).toEqual(newGoals));
    });
  });

  describe("error handling", () => {
    it("should revert optimistic update on error", async () => {
      const initialGoals: GoalsForYear = {
        goals: [
          {
            id: "initial",
            value: 500,
            label: "Initial",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            metric: "",
          },
        ],
      };
      const newGoals: GoalsForYear = {
        goals: [
          {
            id: "new",
            value: 1000,
            label: "New",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
            metric: "",
          },
        ],
      };
      const error = new Error("Failed to save");

      serve(goalsDoc(initialGoals));
      mockServiceInstance.updateConfigSection.mockRejectedValue(error);

      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.data).toEqual(initialGoals);
      });

      await act(async () => {
        try {
          await result.current.updateData(newGoals);
        } catch {
          // Expected
        }
      });

      // Once the error has rendered (React Query renders a tick after `act`), the data is
      // back to the initial goals.
      await waitFor(() => expect(result.current.saveError).toEqual(error));
      expect(result.current.data).toEqual(initialGoals);
    });
  });

  describe("a failed first save", () => {
    // Nothing is cached before it but null, which the rollback must restore too.
    const newGoals: GoalsForYear = {
      goals: [
        {
          id: "new",
          value: 1000,
          label: "New",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
          metric: "",
        },
      ],
    };
    // React Query renders its updates on a later tick than `act` flushes, so each test waits
    // for the error to render; the rollback runs before the error is set.
    const saveAndFail = async (result: {
      current: { updateData: (d: GoalsForYear) => Promise<void> };
    }) => {
      await act(async () => {
        await result.current.updateData(newGoals).catch(() => {});
      });
    };

    it("is rolled back on an empty section", async () => {
      serve(null);
      mockServiceInstance.updateConfigSection.mockRejectedValue(new Error("Failed to save"));
      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await saveAndFail(result);

      await waitFor(() => expect(result.current.saveError).toBeInstanceOf(Error));
      expect(result.current.data).toBeNull();
    });

    it("is rolled back in demo mode when localStorage refuses the write", async () => {
      mockAuthState = { user: null, loading: false };
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error("QuotaExceededError");
      });
      const { result } = renderHook(() => useUserConfig("goals", 2025, "cycling"), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.loading).toBe(false));

      await saveAndFail(result);

      await waitFor(() => expect(result.current.saveError).toBeInstanceOf(Error));
      expect(result.current.data).toBeNull();
    });
  });
});

describe("useFullUserConfig", () => {
  let mockServiceInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceMocks();
    mockServiceInstance = UserConfigService.prototype;
    mockAuthState = { user: mockUser, loading: false };
  });

  it("should load full config", async () => {
    const mockConfig = { goals: {}, annotations: {}, preferences: {} };
    mockServiceInstance.getConfig.mockResolvedValue(mockConfig);
    mockServiceInstance.subscribeToConfig.mockImplementation((cb: any) => {
      cb(mockConfig);
      return vi.fn();
    });

    const { result } = renderHook(() => useFullUserConfig(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.config).toEqual(mockConfig);
  });

  it("should call updateSection correctly", async () => {
    const mockConfig = { goals: {}, annotations: {}, preferences: {} };
    mockServiceInstance.getConfig.mockResolvedValue(mockConfig);
    mockServiceInstance.subscribeToConfig.mockImplementation((cb: any) => {
      cb(mockConfig);
      return vi.fn();
    });

    const { result } = renderHook(() => useFullUserConfig(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const newGoals: GoalsForYear = {
      goals: [
        {
          id: "1",
          value: 1000,
          label: "Test",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
          metric: "",
        },
      ],
    };
    await act(async () => {
      await result.current.updateSection("goals", newGoals, 2025, "cycling");
    });

    expect(mockServiceInstance.updateConfigSection).toHaveBeenCalledWith(
      "goals",
      newGoals,
      2025,
      "cycling"
    );
  });

  it("should return null in localStorage mode", async () => {
    mockAuthState = { user: null, loading: false };
    const { result } = renderHook(() => useFullUserConfig(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toBeNull();
  });
});
