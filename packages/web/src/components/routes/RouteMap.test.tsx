import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import RouteMap from "./RouteMap";
import type { RegionSummary } from "../../api/map";

// Mock react-map-gl: capture the props RouteMap wires into <Map> (transformRequest,
// onError, initialViewState, mapStyle) and the declarative <Source>/<Layer> props,
// and expose a fake `fitBounds` through the forwarded MapRef so the viewport-fit
// effect can be exercised without WebGL.
const h = vi.hoisted(() => {
  const captured = {
    transformRequest: undefined as ((url: string) => unknown) | undefined,
    onError: undefined as ((e: unknown) => void) | undefined,
    onClick: undefined as ((e: unknown) => void) | undefined,
    onMouseMove: undefined as ((e: unknown) => void) | undefined,
    onMouseLeave: undefined as ((e: unknown) => void) | undefined,
    onLoad: undefined as (() => void) | undefined,
    projection: undefined as unknown,
    resizeCalls: 0,
    initialViewState: undefined as Record<string, unknown> | undefined,
    mapStyle: undefined as string | undefined,
    interactiveLayerIds: undefined as string[] | undefined,
    fitBoundsCalls: [] as unknown[],
    featureStateCalls: [] as { feature: unknown; state: unknown }[],
    sources: [] as Record<string, unknown>[],
    layers: [] as Record<string, unknown>[],
    sourceMounts: 0,
  };
  return { captured };
});

vi.mock("react-map-gl/mapbox", async () => {
  const React = await import("react");
  const Map = React.forwardRef(function Map(
    props: Record<string, unknown> & { children?: React.ReactNode },
    ref: React.Ref<unknown>
  ) {
    h.captured.transformRequest = props.transformRequest as (url: string) => unknown;
    h.captured.onError = props.onError as (e: unknown) => void;
    h.captured.onClick = props.onClick as (e: unknown) => void;
    h.captured.onMouseMove = props.onMouseMove as (e: unknown) => void;
    h.captured.onMouseLeave = props.onMouseLeave as (e: unknown) => void;
    h.captured.onLoad = props.onLoad as () => void;
    h.captured.projection = props.projection;
    h.captured.initialViewState = props.initialViewState as Record<string, unknown>;
    h.captured.mapStyle = props.mapStyle as string;
    h.captured.interactiveLayerIds = props.interactiveLayerIds as string[];
    React.useImperativeHandle(ref, () => ({
      fitBounds: (...args: unknown[]) => h.captured.fitBoundsCalls.push(args),
      setFeatureState: (feature: unknown, state: unknown) =>
        h.captured.featureStateCalls.push({ feature, state }),
      resize: () => {
        h.captured.resizeCalls += 1;
      },
      getZoom: () => 10,
      getCanvas: () => ({ style: {} }),
    }));
    return React.createElement("div", { "data-testid": "map" }, props.children);
  });
  const Source = (props: Record<string, unknown> & { children?: React.ReactNode }) => {
    // Count mounts (not renders): a `key` change remounts the component, so this
    // increments only on a genuine source recreation — the tile re-fetch mechanism.
    React.useEffect(() => {
      h.captured.sourceMounts += 1;
    }, []);
    h.captured.sources.push(props);
    return React.createElement(React.Fragment, null, props.children);
  };
  const Layer = (props: Record<string, unknown>) => {
    h.captured.layers.push(props);
    return null;
  };
  const NavigationControl = () => React.createElement("div", { "data-testid": "nav-control" });
  const Popup = (props: Record<string, unknown> & { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "popup" }, props.children);
  return { __esModule: true, Map, default: Map, Source, Layer, NavigationControl, Popup };
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const API_BASE = "http://localhost:8084/api/v1";
const TILE_URL = "http://localhost:8084/api/v1/activities/map/tiles/{z}/{x}/{y}";
const A_TILE = "http://localhost:8084/api/v1/activities/map/tiles/1/2/3";
const MAPBOX_URL = "https://api.mapbox.com/styles/v1/mapbox/dark-v11";

function resetCaptured() {
  h.captured.transformRequest = undefined;
  h.captured.onError = undefined;
  h.captured.onClick = undefined;
  h.captured.onMouseMove = undefined;
  h.captured.onMouseLeave = undefined;
  h.captured.onLoad = undefined;
  h.captured.projection = undefined;
  h.captured.resizeCalls = 0;
  h.captured.initialViewState = undefined;
  h.captured.mapStyle = undefined;
  h.captured.interactiveLayerIds = undefined;
  h.captured.fitBoundsCalls.length = 0;
  h.captured.featureStateCalls.length = 0;
  h.captured.sources.length = 0;
  h.captured.layers.length = 0;
  h.captured.sourceMounts = 0;
}

/** Latest render of the base / highlight line layers (the mock accumulates renders). */
const baseLayer = () => h.captured.layers.filter((l) => l.id === "routes-lines").at(-1);
const highlightLayer = () =>
  h.captured.layers.filter((l) => l.id === "routes-lines-highlight").at(-1);

function renderMap(overrides: Partial<React.ComponentProps<typeof RouteMap>> = {}) {
  const props = {
    accessToken: "pk.test",
    tileTemplateUrl: TILE_URL,
    apiBaseUrl: API_BASE,
    getAuthToken: () => "T" as string | undefined,
    refreshAuthToken: vi.fn().mockResolvedValue(undefined),
    colorExpression: "rgb(0,255,255)",
    defaultViewport: null,
    isDark: true,
    distanceUnit: "miles" as const,
    selected: null,
    onSelect: vi.fn(),
    ...overrides,
  };
  const utils = render(<RouteMap {...props} />);
  return { props, ...utils };
}

type TransformRequest = (url: string) => { url: string; headers?: Record<string, string> };

describe("RouteMap transformRequest auth invariant", () => {
  beforeEach(() => {
    resetCaptured();
    vi.clearAllMocks();
  });

  it("attaches the Bearer token to internal tile requests", () => {
    renderMap();
    const transformRequest = h.captured.transformRequest as TransformRequest;

    expect(transformRequest(A_TILE)).toEqual({
      url: A_TILE,
      headers: { Authorization: "Bearer T" },
    });
  });

  it("never attaches the token to Mapbox's own (external) requests", () => {
    renderMap();
    const transformRequest = h.captured.transformRequest as TransformRequest;

    expect(transformRequest(MAPBOX_URL)).toEqual({ url: MAPBOX_URL });
  });

  it("attaches no header when the token is undefined", () => {
    renderMap({ getAuthToken: () => undefined });
    const transformRequest = h.captured.transformRequest as TransformRequest;

    expect(transformRequest(A_TILE)).toEqual({ url: A_TILE });
  });
});

describe("RouteMap layer setup", () => {
  beforeEach(() => {
    resetCaptured();
    vi.clearAllMocks();
  });

  it("declares the MVT vector source + line layer with the backend source-layer", () => {
    renderMap();

    expect(h.captured.sources.at(-1)).toMatchObject({
      id: "routes-src",
      type: "vector",
      tiles: [TILE_URL],
    });
    expect(baseLayer()).toMatchObject({
      id: "routes-lines",
      type: "line",
      "source-layer": "routes",
    });
  });

  it("splits the level-of-detail at zoom 8: lines (minzoom) above, density dots (maxzoom) below", () => {
    renderMap();

    // Route lines only render at/above the handoff zoom...
    expect(baseLayer()).toMatchObject({ minzoom: 8 });
    expect(highlightLayer()).toMatchObject({ minzoom: 8 });

    // ...and the grid-binned density dots (the server's `route_points` layer) only
    // render below it — a clean handoff, no overlap.
    const points = h.captured.layers.filter((l) => l.id === "routes-points").at(-1);
    expect(points).toMatchObject({
      type: "circle",
      "source-layer": "route_points",
      maxzoom: 8,
    });
    // Per-sport dots stack largest-behind: sort-key = -count (ascending draws first,
    // so the biggest circle is at the back and smaller sports sit on top, all visible).
    expect((points!.layout as Record<string, unknown>)["circle-sort-key"]).toEqual([
      "*",
      -1,
      ["get", "activity_count"],
    ]);
    // The dots are not interactive (overview only — not in the cross-filter).
    // Interactivity is on the fat invisible hit layer, not the thin visible line.
    expect(h.captured.interactiveLayerIds).toEqual(["routes-lines-hit"]);
  });

  it("themes the basemap and passes the color expression to the line layer", () => {
    renderMap({ isDark: false, colorExpression: "rgb(1,2,3)" });

    expect(h.captured.mapStyle).toBe("mapbox://styles/mapbox/light-v11");
    expect((baseLayer()!.paint as Record<string, unknown>)["line-color"]).toBe("rgb(1,2,3)");
  });

  it("promotes the MVT activity_id property to the feature id", () => {
    renderMap();

    expect(h.captured.sources.at(-1)!.promoteId).toEqual({ routes: "activity_id" });
  });

  it("applies the cross-filter expression to the base line layer when provided", () => {
    const filter = ["in", ["get", "activity_id"], ["literal", [1, 2]]] as never;
    renderMap({ filter });

    expect(baseLayer()!.filter).toEqual(filter);
  });

  it("omits the base layer filter (shows all routes) when filter is null", () => {
    renderMap({ filter: null });

    expect(baseLayer()!).not.toHaveProperty("filter");
  });
});

describe("RouteMap interactivity (hover + click popover)", () => {
  beforeEach(() => {
    resetCaptured();
    vi.clearAllMocks();
  });

  const feature = (id: number, props: Record<string, unknown> = {}) => ({
    features: [
      { id, properties: { name: "Morning Ride", distance: 45000, date: "2026-05-01", ...props } },
    ],
    lngLat: { lng: -74, lat: 40.7 },
  });

  it("routes interactivity through the fat invisible hit layer (touch-friendly)", () => {
    renderMap();
    expect(h.captured.interactiveLayerIds).toEqual(["routes-lines-hit"]);
    // The hit layer is transparent, wide, and carries the cross-filter so only
    // visible routes are selectable.
    const filter = ["in", ["get", "activity_id"], ["literal", [5]]] as never;
    resetCaptured();
    renderMap({ filter });
    const hit = h.captured.layers.filter((l) => l.id === "routes-lines-hit").at(-1);
    expect(hit).toMatchObject({ type: "line", "source-layer": "routes", filter });
    const paint = hit!.paint as Record<string, unknown>;
    expect(paint["line-opacity"]).toBe(0);
    expect(paint["line-width"]).toBeGreaterThan(10);
  });

  it("highlights the hovered route via the highlight layer filter (not feature-state)", () => {
    renderMap();
    // Base layer never carries feature-state in its paint (that breaks rendering).
    expect(JSON.stringify(baseLayer()!.paint)).not.toContain("feature-state");

    act(() => h.captured.onMouseMove!(feature(101)));
    expect(highlightLayer()!.filter).toEqual(["in", ["get", "activity_id"], ["literal", [101]]]);

    // Moving to another route highlights only that one.
    act(() => h.captured.onMouseMove!(feature(202)));
    expect(highlightLayer()!.filter).toEqual(["in", ["get", "activity_id"], ["literal", [202]]]);

    // Leaving clears the highlight.
    act(() => h.captured.onMouseLeave?.(undefined));
    expect(highlightLayer()!.filter).toEqual(["in", ["get", "activity_id"], ["literal", []]]);
  });

  it("reports the clicked route up via onSelect (controlled selection)", () => {
    const onSelect = vi.fn();
    renderMap({ onSelect });
    act(() => h.captured.onClick!(feature(123)));
    expect(onSelect).toHaveBeenCalledWith({
      id: 123,
      lng: -74,
      lat: 40.7,
      name: "Morning Ride",
      distanceMeters: 45000,
      date: "2026-05-01",
    });
  });

  it("clears the selection via onSelect(null) when clicking empty map", () => {
    const onSelect = vi.fn();
    renderMap({ onSelect });
    act(() => h.captured.onClick!({ features: [], lngLat: { lng: 0, lat: 0 } }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("renders the popover from the `selected` prop (title/distance/date/time/Strava)", () => {
    renderMap({
      selected: {
        id: 123,
        name: "Morning Ride",
        distanceMeters: 45000,
        date: "2026-05-01",
        lng: -74,
        lat: 40.7,
      },
      getActivity: (id) => ({ activityId: id, movingTime: 3600 }) as never,
    });

    const popup = screen.getByTestId("popup");
    expect(popup).toHaveTextContent("Morning Ride");
    expect(popup).toHaveTextContent(/28(\.0)? mi/); // 45,000 m ≈ 28 mi
    expect(popup).toHaveTextContent("May 1, 2026"); // formatted (not raw 2026-05-01)
    expect(popup).toHaveTextContent("1 hr"); // movingTime 3600s from the lookup
    const link = screen.getByRole("link", { name: /view on strava/i });
    expect(link).toHaveAttribute("href", "https://www.strava.com/activities/123");
  });

  it("highlights the selected route even without a popover position (list selection)", () => {
    renderMap({ selected: { id: 77, name: "x", distanceMeters: 0, date: "" } });
    // No lng/lat → no popover, but the line is still highlighted.
    expect(screen.queryByTestId("popup")).not.toBeInTheDocument();
    expect(highlightLayer()!.filter).toEqual(["in", ["get", "activity_id"], ["literal", [77]]]);
  });
});

describe("RouteMap 401 recovery", () => {
  beforeEach(() => {
    resetCaptured();
    vi.clearAllMocks();
  });

  it("refreshes the token on an internal 401 tile error (debounced)", async () => {
    const refreshAuthToken = vi.fn().mockResolvedValue(undefined);
    renderMap({ refreshAuthToken });

    act(() => {
      h.captured.onError!({ error: { status: 401, url: A_TILE } });
      h.captured.onError!({ error: { status: 401, url: A_TILE } });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
  });

  it("remounts the routes source after a 401 refresh to force a tile re-fetch", async () => {
    const refreshAuthToken = vi.fn().mockResolvedValue(undefined);
    renderMap({ refreshAuthToken });
    const mountsBefore = h.captured.sourceMounts;

    await act(async () => {
      h.captured.onError!({ error: { status: 401, url: A_TILE } });
      await Promise.resolve();
    });

    // Bumped key → react-map-gl unmounts + remounts the source (removeSource/addSource).
    expect(h.captured.sourceMounts).toBeGreaterThan(mountsBefore);
  });

  it("does NOT refresh the Firebase token on a Mapbox-side (external) 401", () => {
    const refreshAuthToken = vi.fn().mockResolvedValue(undefined);
    renderMap({ refreshAuthToken });

    act(() => h.captured.onError!({ error: { status: 401, url: MAPBOX_URL } }));

    expect(refreshAuthToken).not.toHaveBeenCalled();
  });

  it("ignores non-401 errors", () => {
    const refreshAuthToken = vi.fn().mockResolvedValue(undefined);
    renderMap({ refreshAuthToken });

    act(() => h.captured.onError!({ error: { status: 500, url: A_TILE, message: "boom" } }));

    expect(refreshAuthToken).not.toHaveBeenCalled();
  });
});

describe("RouteMap viewport fitting", () => {
  beforeEach(() => {
    resetCaptured();
    vi.clearAllMocks();
  });

  const baseProps = {
    accessToken: "pk.test",
    tileTemplateUrl: TILE_URL,
    apiBaseUrl: API_BASE,
    getAuthToken: () => "T" as string | undefined,
    refreshAuthToken: vi.fn().mockResolvedValue(undefined),
    colorExpression: "rgb(0,255,255)",
    isDark: true,
    distanceUnit: "miles" as const,
    selected: null,
    onSelect: vi.fn(),
  };
  const regionA: RegionSummary = {
    regionId: 1,
    name: "A",
    kind: "metro",
    activityCount: 1,
    bbox: [0, 0, 1, 1],
  };
  const regionB: RegionSummary = { ...regionA, regionId: 2, bbox: [2, 2, 3, 3] };

  it("fits the initial region via initialViewState, not a re-fit on mount", () => {
    render(<RouteMap {...baseProps} defaultViewport={regionA} />);

    // initialViewState carries the bounds; the imperative fitBounds must not re-fire.
    expect(h.captured.initialViewState).toMatchObject({
      bounds: [
        [0, 0],
        [1, 1],
      ],
    });
    expect(h.captured.fitBoundsCalls.length).toBe(0);
  });

  it("fits when the viewport resolves but not again on a same-region refetch", () => {
    const { rerender } = render(<RouteMap {...baseProps} defaultViewport={null} />);
    expect(h.captured.fitBoundsCalls.length).toBe(0); // world view via initialViewState

    rerender(<RouteMap {...baseProps} defaultViewport={regionA} />);
    expect(h.captured.fitBoundsCalls.length).toBe(1); // first resolve → fit

    // Background query refetch: new object, same regionId → no disruptive re-fit.
    rerender(<RouteMap {...baseProps} defaultViewport={{ ...regionA }} />);
    expect(h.captured.fitBoundsCalls.length).toBe(1);

    // A genuine region change does fit again.
    rerender(<RouteMap {...baseProps} defaultViewport={regionB} />);
    expect(h.captured.fitBoundsCalls.length).toBe(2);
  });
});

describe("RouteMap load + error UX", () => {
  beforeEach(() => {
    resetCaptured();
    vi.clearAllMocks();
  });

  it("forces the flat mercator projection (not GL JS v3's default globe)", () => {
    renderMap();
    expect(h.captured.projection).toEqual({ name: "mercator" });
  });

  it("shows a loading spinner until the map fires `load`, then resizes and hides it", () => {
    renderMap();
    // Spinner is up from mount (covers the basemap/tiles-still-loading gap).
    expect(screen.getByText("Loading map…")).toBeInTheDocument();
    expect(h.captured.resizeCalls).toBe(0);

    act(() => h.captured.onLoad!());

    // load → resize (iOS WebKit canvas-size fix) + spinner cleared.
    expect(h.captured.resizeCalls).toBe(1);
    expect(screen.queryByText("Loading map…")).not.toBeInTheDocument();
  });

  it("surfaces a retryable error if `load` never arrives, and retry returns to loading", () => {
    vi.useFakeTimers();
    try {
      renderMap();
      expect(screen.getByText("Loading map…")).toBeInTheDocument();

      // No `load` within the timeout → the failure surface replaces the silent grey.
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      const retry = screen.getByRole("button", { name: /try again/i });
      expect(retry).toBeInTheDocument();
      expect(screen.queryByText("Loading map…")).not.toBeInTheDocument();

      // Retry recreates the map and shows the spinner again.
      act(() => retry.click());
      expect(screen.getByText("Loading map…")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a working map mounted (a tile 401 doesn't trip the error overlay)", async () => {
    renderMap();
    act(() => h.captured.onLoad!()); // map is up

    await act(async () => {
      h.captured.onError!({ error: { status: 401, url: A_TILE } });
      await Promise.resolve();
    });

    // The 401 path recovers tiles; it must not flip the whole map to the error state.
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("surfaces the error immediately on a Mapbox-side auth failure (no 15s wait)", () => {
    const refreshAuthToken = vi.fn().mockResolvedValue(undefined);
    renderMap({ refreshAuthToken });

    // A bad/over-restricted pk.* token 403s the style — unrecoverable by a Firebase
    // refresh, so we don't wait out the load timeout: show the retry surface now.
    act(() => h.captured.onError!({ error: { status: 403, url: MAPBOX_URL } }));

    expect(refreshAuthToken).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Loading map…")).not.toBeInTheDocument();
  });

  it("does not clobber an already-rendered map on a later external auth error", () => {
    renderMap();
    act(() => h.captured.onLoad!()); // ready
    act(() => h.captured.onError!({ error: { status: 401, url: MAPBOX_URL } }));

    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });
});

describe("RouteMap zoom control (touch vs desktop)", () => {
  beforeEach(() => {
    resetCaptured();
    vi.clearAllMocks();
  });

  // useIsMobile reads matchMedia at mount; override per test, restore after.
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

  it("shows the NavigationControl on desktop", () => {
    const restore = setViewport(false);
    try {
      renderMap();
      expect(screen.getByTestId("nav-control")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("hides the NavigationControl on touch (pinch-zoom covers it)", () => {
    const restore = setViewport(true);
    try {
      renderMap();
      expect(screen.queryByTestId("nav-control")).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
