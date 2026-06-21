import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import RouteMap from "./RouteMap";

// Fake mapbox-gl Map that captures constructor options + event handlers so the
// tests can exercise the real transformRequest / error callbacks.
const h = vi.hoisted(() => {
  type Handler = (arg?: unknown) => void;
  class FakeMap {
    opts: Record<string, unknown>;
    handlers: Record<string, Handler[]> = {};
    sources: Record<string, unknown> = {};
    layers: Record<string, unknown> = {};
    paint: Record<string, unknown> = {};
    removed = false;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      instances.push(this);
    }
    addControl() {
      return this;
    }
    on(ev: string, cb: Handler) {
      (this.handlers[ev] ||= []).push(cb);
      return this;
    }
    emit(ev: string, arg?: unknown) {
      (this.handlers[ev] || []).forEach((cb) => cb(arg));
    }
    getSource(id: string) {
      return this.sources[id];
    }
    getLayer(id: string) {
      return this.layers[id];
    }
    addSource(id: string, s: unknown) {
      this.sources[id] = s;
    }
    addLayer(l: { id: string }) {
      this.layers[l.id] = l;
    }
    removeLayer(id: string) {
      delete this.layers[id];
    }
    removeSource(id: string) {
      delete this.sources[id];
    }
    setPaintProperty(layer: string, prop: string, val: unknown) {
      this.paint[`${layer}.${prop}`] = val;
    }
    getStyle() {
      return {};
    }
    setStyle(s: unknown) {
      this.opts.style = s;
    }
    fitBounds() {}
    remove() {
      this.removed = true;
    }
  }
  class FakeNavigationControl {}
  const instances: FakeMap[] = [];
  return { instances, FakeMap, FakeNavigationControl };
});

vi.mock("mapbox-gl", () => ({
  default: { Map: h.FakeMap, NavigationControl: h.FakeNavigationControl, accessToken: "" },
}));
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

const API_BASE = "http://localhost:8084/api/v1";
const TILE_URL = "http://localhost:8084/api/v1/activities/map/tiles/{z}/{x}/{y}";
const A_TILE = "http://localhost:8084/api/v1/activities/map/tiles/1/2/3";
const MAPBOX_URL = "https://api.mapbox.com/styles/v1/mapbox/dark-v11";

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
    ...overrides,
  };
  render(<RouteMap {...props} />);
  const map = h.instances.at(-1)!;
  return { map, props };
}

type TransformRequest = (url: string) => { url: string; headers?: Record<string, string> };

describe("RouteMap transformRequest auth invariant", () => {
  beforeEach(() => {
    h.instances.length = 0;
    vi.clearAllMocks();
  });

  it("attaches the Bearer token to internal tile requests", () => {
    const { map } = renderMap();
    const transformRequest = map.opts.transformRequest as TransformRequest;

    expect(transformRequest(A_TILE)).toEqual({
      url: A_TILE,
      headers: { Authorization: "Bearer T" },
    });
  });

  it("never attaches the token to Mapbox's own (external) requests", () => {
    const { map } = renderMap();
    const transformRequest = map.opts.transformRequest as TransformRequest;

    expect(transformRequest(MAPBOX_URL)).toEqual({ url: MAPBOX_URL });
  });

  it("attaches no header when the token is undefined", () => {
    const { map } = renderMap({ getAuthToken: () => undefined });
    const transformRequest = map.opts.transformRequest as TransformRequest;

    expect(transformRequest(A_TILE)).toEqual({ url: A_TILE });
  });
});

describe("RouteMap layer setup", () => {
  beforeEach(() => {
    h.instances.length = 0;
    vi.clearAllMocks();
  });

  it("adds the MVT source + line layer with the backend source-layer on style load", () => {
    const { map } = renderMap();
    act(() => map.emit("style.load"));

    expect(map.getSource("routes-src")).toMatchObject({ type: "vector", tiles: [TILE_URL] });
    expect(map.getLayer("routes-lines")).toMatchObject({
      type: "line",
      source: "routes-src",
      "source-layer": "routes",
    });
  });
});

describe("RouteMap 401 recovery", () => {
  beforeEach(() => {
    h.instances.length = 0;
    vi.clearAllMocks();
  });

  it("refreshes the token on an internal 401 tile error (debounced)", async () => {
    const refreshAuthToken = vi.fn().mockResolvedValue(undefined);
    const { map } = renderMap({ refreshAuthToken });
    act(() => map.emit("style.load"));

    act(() => {
      map.emit("error", { error: { status: 401, url: A_TILE } });
      map.emit("error", { error: { status: 401, url: A_TILE } });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(refreshAuthToken).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh the Firebase token on a Mapbox-side (external) 401", () => {
    const refreshAuthToken = vi.fn().mockResolvedValue(undefined);
    const { map } = renderMap({ refreshAuthToken });

    act(() => map.emit("error", { error: { status: 401, url: MAPBOX_URL } }));

    expect(refreshAuthToken).not.toHaveBeenCalled();
  });

  it("ignores non-401 errors", () => {
    const refreshAuthToken = vi.fn().mockResolvedValue(undefined);
    const { map } = renderMap({ refreshAuthToken });

    act(() => map.emit("error", { error: { status: 500, url: A_TILE, message: "boom" } }));

    expect(refreshAuthToken).not.toHaveBeenCalled();
  });
});
