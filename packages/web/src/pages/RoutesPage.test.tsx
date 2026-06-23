import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import RoutesPage from "./RoutesPage";
import { renderWithRouter } from "../test/renderWithRouter";
import type { RegionSummary } from "../api/map";

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

  it("mounts the non-modal filter drawer over the map", async () => {
    await renderWithRouter(<RoutesPage />);

    await screen.findByTestId("route-map");
    // Drawer is open by default → its header collapse control is present.
    expect(await screen.findByRole("button", { name: /collapse panel/i })).toBeInTheDocument();
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
    // empty, so useRouteFilters yields no filter → map shows all routes).
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

    expect(screen.getByText("Loading map...")).toBeInTheDocument();
    expect(screen.queryByTestId("route-map")).not.toBeInTheDocument();
  });

  it("mounts the map once auth settles even if the token is briefly unavailable", async () => {
    // Graceful degradation: don't hang on a missing token — the basemap renders
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

    expect(screen.getByText("Loading map...")).toBeInTheDocument();
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
});
