import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import RoutesPage from "./RoutesPage";
import { renderWithRouter } from "../test/renderWithRouter";
import type { MapActivity, RegionSummary } from "../api/map";

// Mock hooks
vi.mock("../hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../hooks/useRouteRegions", () => ({
  useRouteRegions: vi.fn(),
}));

vi.mock("../hooks/useSportConfig", () => ({
  useSportConfig: vi.fn(() => ({
    sportConfig: null,
    isLoading: false,
    error: null,
    retry: vi.fn(),
  })),
}));

vi.mock("../hooks/useAuthTokenRef", () => ({
  useAuthTokenRef: vi.fn(() => ({
    getToken: () => "firebase-token",
    token: "firebase-token",
    ready: true,
    refresh: vi.fn(),
  })),
}));

vi.mock("../contexts/ThemeContext", () => ({
  useTheme: vi.fn(() => ({ resolvedTheme: "dark", theme: "dark", setTheme: vi.fn() })),
}));

// Cross-filter dataset + user prefs. Mocked here so the page test stays a unit
// test and doesn't pull the firebase-backed userConfig service at import.
vi.mock("../hooks/useMapDataset", () => ({
  useMapDataset: vi.fn(() => ({ activities: [], isLoading: false, error: null })),
}));

vi.mock("../hooks/useUserConfig", () => ({
  useUserConfig: vi.fn(() => ({ data: null })),
}));

// Mocked so the page stays a unit test (the real hook needs a QueryClientProvider,
// which renderWithRouter doesn't supply); the wiring is covered in useRefreshMapData.test.
vi.mock("../hooks/useRefreshMapData", () => ({
  useRefreshMapData: vi.fn(() => ({ refresh: vi.fn(), isRefreshing: false })),
}));

// Mock config so the Mapbox token + gateway are present by default.
vi.mock("../lib/config", () => ({
  getConfig: vi.fn(),
}));

// Capture the props the page wires into the (lazy) map so we can assert wiring.
const mapPropsSpy = vi.fn();
vi.mock("../components/routes/RouteMap", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mapPropsSpy(props);
    return <div data-testid="route-map" />;
  },
}));

import { useAuth } from "../hooks/useAuth";
import { useRouteRegions } from "../hooks/useRouteRegions";
import { useAuthTokenRef } from "../hooks/useAuthTokenRef";
import { getConfig } from "../lib/config";

const mockUseAuth = vi.mocked(useAuth);
const mockUseRouteRegions = vi.mocked(useRouteRegions);
const mockUseAuthTokenRef = vi.mocked(useAuthTokenRef);
const mockGetConfig = vi.mocked(getConfig);

import { useMapDataset } from "../hooks/useMapDataset";
const mockUseMapDataset = vi.mocked(useMapDataset);

import { useRefreshMapData } from "../hooks/useRefreshMapData";
const mockUseRefreshMapData = vi.mocked(useRefreshMapData);

/** Props of the most recent <RouteMap> render (the mock spies on them). */
const lastMapProps = () => mapPropsSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;

const authedUser = {
  user: { uid: "u1", email: "a@b.com", displayName: "Test", photoURL: null },
  loading: false,
  error: null,
  signIn: vi.fn(),
  signOut: vi.fn(),
};

const viewport: RegionSummary = {
  regionId: 101,
  name: "New York",
  kind: "metro",
  activityCount: 42,
  bbox: [-74.1, 40.6, -73.8, 40.9],
};

function mockConfig(overrides: Partial<ReturnType<typeof getConfig>> = {}) {
  mockGetConfig.mockReturnValue({
    mapboxToken: "pk.test-token",
    apiGatewayUrl: "http://localhost:8084/api",
    isProduction: false,
    isDevelopment: true,
    ...overrides,
  } as ReturnType<typeof getConfig>);
}

describe("RoutesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig();
    mockUseAuth.mockReturnValue(authedUser);
    mockUseAuthTokenRef.mockReturnValue({
      getToken: () => "firebase-token",
      token: "firebase-token",
      ready: true,
      refresh: vi.fn(),
    });
    mockUseRouteRegions.mockReturnValue({
      regions: [viewport],
      defaultViewport: viewport,
      isLoading: false,
      error: null,
    });
    // Reset the dataset to empty each test â clearAllMocks doesn't undo a
    // per-test mockReturnValue (e.g. the deep-link focus test sets one).
    mockUseMapDataset.mockReturnValue({ activities: [], isLoading: false, error: null });
  });

  it("shows sign-in prompt when unauthenticated", async () => {
    mockUseAuth.mockReturnValue({ ...authedUser, user: null });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByText(/to view your route map/)).toBeInTheDocument();
  });

  it("renders the map when authenticated with a viewport", async () => {
    await renderWithRouter(<RoutesPage />);

    expect(await screen.findByTestId("route-map")).toBeInTheDocument();
    expect(screen.queryByText(/No routes yet/)).not.toBeInTheDocument();
  });

  it("deep-link ?activity=<id> focuses the map on that one route + offers Show all", async () => {
    await renderWithRouter(<RoutesPage />, { route: "/?activity=12345" });

    await screen.findByTestId("route-map");
    // The map filter is overridden to that single activity id.
    expect(lastMapProps().filter).toEqual(["in", ["get", "activity_id"], ["literal", [12345]]]);
    // An explicit way back to the full map is shown.
    expect(screen.getByRole("button", { name: /show all/i })).toBeInTheDocument();
    // The id isn't in this (empty) dataset â a clear, non-error notice.
    expect(screen.getByText(/isn't on your map/i)).toBeInTheDocument();
  });

  it("opens the popup for a deep-linked activity that's in the dataset", async () => {
    const activity: MapActivity = {
      activityId: 12345,
      name: "Deep-linked Ride",
      sport: "cycling",
      distanceMeters: 30_000,
      movingTime: 3_600,
      startDateLocal: "2026-05-01T08:00:00",
      regionIds: [],
      bbox: [-74.1, 40.6, -73.8, 40.9],
    };
    mockUseMapDataset.mockReturnValue({ activities: [activity], isLoading: false, error: null });

    await renderWithRouter(<RoutesPage />, { route: "/?activity=12345" });
    await screen.findByTestId("route-map");

    // The focus effect selects the activity (opens its popup, anchored at bbox center).
    await waitFor(() => {
      expect((lastMapProps().selected as { id?: number } | null)?.id).toBe(12345);
    });
    expect(screen.getByText(/showing one activity/i)).toBeInTheDocument();
  });

  it("Show all clears the focus and restores the full map", async () => {
    await renderWithRouter(<RoutesPage />, { route: "/?activity=12345" });
    await screen.findByTestId("route-map");
    const focusedFilter = ["in", ["get", "activity_id"], ["literal", [12345]]];
    expect(lastMapProps().filter).toEqual(focusedFilter);

    fireEvent.click(screen.getByRole("button", { name: /show all/i }));

    await waitFor(() => expect(lastMapProps().filter).not.toEqual(focusedFilter));
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });

  it("mounts the non-modal filter drawer over the map", async () => {
    await renderWithRouter(<RoutesPage />);

    await screen.findByTestId("route-map");
    // Drawer is open by default â its header collapse control is present. The drawer
    // is lazy-loaded (its own async chunk), so give findBy a generous window â
    // the default 1s can flake under full-suite/CI load (still well under the 5s
    // test timeout). The DOM otherwise shows only the map (Suspense fallback).
    expect(
      await screen.findByRole("button", { name: /collapse panel/i }, { timeout: 4000 })
    ).toBeInTheDocument();
  });

  it("wires the filter drawer's refresh control to refreshMapData", async () => {
    const refresh = vi.fn();
    mockUseRefreshMapData.mockReturnValue({ refresh, isRefreshing: false });

    await renderWithRouter(<RoutesPage />);
    await screen.findByTestId("route-map");

    // The refresh control lives in the (lazy) filter drawer header — give findBy room.
    const btn = await screen.findByRole("button", { name: /refresh map data/i }, { timeout: 4000 });
    fireEvent.click(btn);
    expect(refresh).toHaveBeenCalled();
  });

  it("mounts the insight charts only while the charts drawer is open", async () => {
    const activity: MapActivity = {
      activityId: 1,
      name: "Ride",
      sport: "cycling",
      distanceMeters: 10_000,
      movingTime: 1_800,
      startDateLocal: "2026-05-01T08:00:00",
      regionIds: [],
      bbox: [-74.1, 40.6, -73.8, 40.9],
    };
    mockUseMapDataset.mockReturnValue({ activities: [activity], isLoading: false, error: null });

    await renderWithRouter(<RoutesPage />);
    await screen.findByTestId("route-map");

    // Charts drawer is closed by default → the chart subtree isn't mounted.
    expect(screen.queryByLabelText("Region breakdown")).not.toBeInTheDocument();

    // Opening it mounts the charts.
    fireEvent.click(await screen.findByRole("button", { name: /^charts$/i }, { timeout: 4000 }));
    expect(
      await screen.findByLabelText("Region breakdown", {}, { timeout: 4000 })
    ).toBeInTheDocument();
  });

  it("wires the resolved token, tile URL, and viewport into the map", async () => {
    await renderWithRouter(<RoutesPage />);
    await screen.findByTestId("route-map");

    expect(mapPropsSpy).toHaveBeenCalled();
    const props = mapPropsSpy.mock.calls.at(-1)![0];
    expect(props.accessToken).toBe("pk.test-token");
    expect(props.tileTemplateUrl).toBe(
      "http://localhost:8084/api/v1/activities/map/tiles/{z}/{x}/{y}"
    );
    expect(props.apiBaseUrl).toBe("http://localhost:8084/api/v1");
    expect(props.defaultViewport).toEqual(viewport);
    expect(props.isDark).toBe(true);
    // Cross-filter expression is wired through (null here: the mocked dataset is
    // empty, so useRouteFilters yields no filter â map shows all routes).
    expect(props).toHaveProperty("filter");
    expect(props.filter).toBeNull();
    expect(typeof props.getAuthToken).toBe("function");
    expect(props.getAuthToken()).toBe("firebase-token");
    expect(typeof props.refreshAuthToken).toBe("function");
  });

  it("shows an empty hint when there are no geo-bearing activities", async () => {
    mockUseRouteRegions.mockReturnValue({
      regions: [],
      defaultViewport: null,
      isLoading: false,
      error: null,
    });

    await renderWithRouter(<RoutesPage />);

    expect(await screen.findByText(/No routes yet/)).toBeInTheDocument();
  });

  it("loads until auth settles (tokenReady is false)", async () => {
    mockUseAuthTokenRef.mockReturnValue({
      getToken: () => undefined,
      token: undefined,
      ready: false,
      refresh: vi.fn(),
    });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText("Loading map…")).toBeInTheDocument();
    expect(screen.queryByTestId("route-map")).not.toBeInTheDocument();
  });

  it("mounts the map once auth settles even if the token is briefly unavailable", async () => {
    // Graceful degradation: don't hang on a missing token â the basemap renders
    // and RouteMap's 401-recovery re-requests tiles once a token lands.
    mockUseAuthTokenRef.mockReturnValue({
      getToken: () => undefined,
      token: undefined,
      ready: true,
      refresh: vi.fn(),
    });

    await renderWithRouter(<RoutesPage />);

    expect(await screen.findByTestId("route-map")).toBeInTheDocument();
  });

  it("shows a loading state while regions load", async () => {
    mockUseRouteRegions.mockReturnValue({
      regions: [],
      defaultViewport: null,
      isLoading: true,
      error: null,
    });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText("Loading map…")).toBeInTheDocument();
  });

  it("shows an error state when regions fail to load", async () => {
    mockUseRouteRegions.mockReturnValue({
      regions: [],
      defaultViewport: null,
      isLoading: false,
      error: new Error("boom"),
    });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText(/Failed to load map/)).toBeInTheDocument();
  });

  it("degrades gracefully when the Mapbox token is missing", async () => {
    mockConfig({ mapboxToken: undefined });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText(/Map is unavailable/)).toBeInTheDocument();
  });

  it("degrades gracefully when the API gateway URL is missing", async () => {
    mockConfig({ apiGatewayUrl: undefined });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText(/Map is unavailable/)).toBeInTheDocument();
  });

  describe("mobile drawer coordination", () => {
    const activity: MapActivity = {
      activityId: 1,
      name: "Ride",
      sport: "cycling",
      distanceMeters: 10_000,
      movingTime: 1_800,
      startDateLocal: "2026-05-01T08:00:00",
      regionIds: [],
      bbox: [-74.1, 40.6, -73.8, 40.9],
    };

    // useIsMobile reads window.matchMedia at mount; override per test, restore after.
    const setViewport = (mobile: boolean) => {
      const original = window.matchMedia;
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        configurable: true,
        value: (query: string) =>
          ({
            matches: mobile && query.includes("max-width"),
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
          }) as unknown as MediaQueryList,
      });
      return () => {
        window.matchMedia = original;
      };
    };

    // Toggles are matched by anchored names so they don't collide with "Reset
    // filters" / "Collapse insights" once a sheet/filter is active.
    const findFiltersToggle = () =>
      screen.findByRole("button", { name: /^filters/i }, { timeout: 4000 });
    const findInsightsToggle = () =>
      screen.findByRole("button", { name: /^charts$/i }, { timeout: 4000 });

    it("starts both sheets closed and keeps them mutually exclusive on a phone", async () => {
      const restore = setViewport(true);
      try {
        mockUseMapDataset.mockReturnValue({
          activities: [activity],
          isLoading: false,
          error: null,
        });
        await renderWithRouter(<RoutesPage />);
        await screen.findByTestId("route-map");

        // On mobile the filter sheet starts CLOSED so the map isn't buried on load.
        const filtersToggle = await findFiltersToggle();
        expect(filtersToggle).toHaveAttribute("aria-expanded", "false");

        // Open filters, then insights — opening insights dismisses filters.
        fireEvent.click(filtersToggle);
        await waitFor(() => expect(filtersToggle).toHaveAttribute("aria-expanded", "true"));

        const insightsToggle = await findInsightsToggle();
        fireEvent.click(insightsToggle);

        await waitFor(() => expect(filtersToggle).toHaveAttribute("aria-expanded", "false"));
        expect(insightsToggle).toHaveAttribute("aria-expanded", "true");
      } finally {
        restore();
      }
    });

    it("opens the filter drawer by default and lets both coexist on desktop", async () => {
      const restore = setViewport(false);
      try {
        mockUseMapDataset.mockReturnValue({
          activities: [activity],
          isLoading: false,
          error: null,
        });
        await renderWithRouter(<RoutesPage />);
        await screen.findByTestId("route-map");

        // Filter drawer (a side panel on desktop) is open by default.
        const filtersToggle = await findFiltersToggle();
        expect(filtersToggle).toHaveAttribute("aria-expanded", "true");

        const insightsToggle = await findInsightsToggle();
        fireEvent.click(insightsToggle);

        // Side panels coexist on desktop — opening insights leaves filters open.
        await waitFor(() => expect(insightsToggle).toHaveAttribute("aria-expanded", "true"));
        expect(filtersToggle).toHaveAttribute("aria-expanded", "true");
      } finally {
        restore();
      }
    });
  });
});
