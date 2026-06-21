import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTileTemplateUrl, buildApiBaseUrl, fetchRouteRegions } from "./map";
import { isInternalRequest } from "./url";

// Mock the axios client + error helper (mirrors other api/*.test.ts).
const mockGet = vi.fn();
vi.mock("./client", () => ({
  default: () => ({ get: mockGet }),
}));
vi.mock("./errors", () => ({
  throwApiError: vi.fn((_err: unknown, context: string) => {
    throw new Error(`throwApiError:${context}`);
  }),
}));

import { throwApiError } from "./errors";

describe("buildTileTemplateUrl", () => {
  const origin = "https://app.example.com";

  it("resolves a same-origin relative gateway path against the app origin", () => {
    expect(buildTileTemplateUrl("/api", origin)).toBe(
      "https://app.example.com/api/v1/activities/map/tiles/{z}/{x}/{y}"
    );
  });

  it("leaves an absolute gateway URL untouched", () => {
    expect(buildTileTemplateUrl("http://localhost:8084/api", origin)).toBe(
      "http://localhost:8084/api/v1/activities/map/tiles/{z}/{x}/{y}"
    );
  });

  it("normalizes a trailing slash so it doesn't produce //v1", () => {
    expect(buildTileTemplateUrl("/api/", origin)).toBe(
      "https://app.example.com/api/v1/activities/map/tiles/{z}/{x}/{y}"
    );
    expect(buildTileTemplateUrl("http://localhost:8084/api/", origin)).toBe(
      "http://localhost:8084/api/v1/activities/map/tiles/{z}/{x}/{y}"
    );
  });

  it("preserves literal {z}/{x}/{y} placeholders (not percent-encoded)", () => {
    const url = buildTileTemplateUrl("/api", origin);
    expect(url).toContain("/{z}/{x}/{y}");
    expect(url).not.toContain("%7B");
  });
});

describe("buildApiBaseUrl", () => {
  const origin = "https://app.example.com";

  it("resolves a same-origin relative gateway path to an absolute base", () => {
    expect(buildApiBaseUrl("/api", origin)).toBe("https://app.example.com/api/v1");
  });

  it("leaves an absolute gateway URL absolute and normalizes a trailing slash", () => {
    expect(buildApiBaseUrl("http://localhost:8084/api", origin)).toBe(
      "http://localhost:8084/api/v1"
    );
    expect(buildApiBaseUrl("/api/", origin)).toBe("https://app.example.com/api/v1");
  });

  it("keeps Mapbox's internal-request classification correct for a same-origin gateway", () => {
    // Regression: a RELATIVE base ("/api/v1") risks misclassifying the absolute
    // tile URL Mapbox actually requests, dropping the auth header (→ 401). The
    // absolute base keeps internal tiles internal and external (mapbox) external.
    const base = buildApiBaseUrl("/api", origin);
    const tileUrl = buildTileTemplateUrl("/api", origin).replace("{z}/{x}/{y}", "1/2/3");

    expect(isInternalRequest(tileUrl, base)).toBe(true);
    expect(isInternalRequest("https://api.mapbox.com/styles/v1/x", base)).toBe(false);
  });
});

describe("fetchRouteRegions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the regions endpoint without a leading slash and passes the abort signal", async () => {
    const signal = new AbortController().signal;
    mockGet.mockResolvedValue({ data: { regions: [], defaultViewport: null } });

    await fetchRouteRegions(signal);

    expect(mockGet).toHaveBeenCalledWith("activities/map/regions", { signal });
  });

  it("null-coalesces a missing/partial body to safe defaults", async () => {
    mockGet.mockResolvedValue({ data: undefined });

    const result = await fetchRouteRegions();

    expect(result).toEqual({ regions: [], defaultViewport: null });
  });

  it("passes through regions and the default viewport", async () => {
    const viewport = {
      regionId: "metro-nyc",
      name: "New York",
      kind: "metro",
      activityCount: 42,
      bbox: [-74.1, 40.6, -73.8, 40.9] as [number, number, number, number],
    };
    mockGet.mockResolvedValue({ data: { regions: [viewport], defaultViewport: viewport } });

    const result = await fetchRouteRegions();

    expect(result.regions).toEqual([viewport]);
    expect(result.defaultViewport).toEqual(viewport);
  });

  it("routes errors through throwApiError with the function context", async () => {
    mockGet.mockRejectedValue(new Error("network"));

    await expect(fetchRouteRegions()).rejects.toThrow("throwApiError:fetchRouteRegions");
    expect(throwApiError).toHaveBeenCalledWith(expect.any(Error), "fetchRouteRegions");
  });
});
