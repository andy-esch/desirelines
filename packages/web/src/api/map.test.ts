import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildTileTemplateUrl,
  buildApiBaseUrl,
  fetchRouteRegions,
  fetchMapDataset,
  type MapActivity,
} from "./map";
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

  it("coerces a protojson int64-as-string regionId to a number", async () => {
    mockGet.mockResolvedValue({
      data: {
        regions: [
          {
            regionId: "98765432109",
            name: "Big Region",
            kind: "country",
            activityCount: 3,
            bbox: [-10, 40, 10, 60],
          },
        ],
      },
    });

    const { regions } = await fetchRouteRegions();
    expect(regions[0]!.regionId).toBe(98765432109);
    expect(typeof regions[0]!.regionId).toBe("number");
  });

  it("rejects a region whose bbox isn't four finite numbers (loud contract drift)", async () => {
    mockGet.mockResolvedValue({
      data: {
        regions: [
          { regionId: 1, name: "Bad", kind: "metro", activityCount: 1, bbox: [-10, 40, 10] },
        ],
      },
    });

    await expect(fetchRouteRegions()).rejects.toThrow("throwApiError:fetchRouteRegions");
  });

  it("passes through regions and the default viewport", async () => {
    const viewport = {
      regionId: 101,
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

describe("fetchMapDataset", () => {
  beforeEach(() => {
    mockGet.mockReset();
    vi.clearAllMocks();
  });

  it("requests the dataset endpoint and forwards the abort signal", async () => {
    const signal = new AbortController().signal;
    mockGet.mockResolvedValue({ data: { activities: [] } });

    await fetchMapDataset(signal);

    expect(mockGet).toHaveBeenCalledWith("activities/map/dataset", { signal });
  });

  it("returns the activities, including name + region tags", async () => {
    const activity: MapActivity = {
      activityId: 42,
      name: "Morning Ride",
      sport: "cycling",
      distanceMeters: 30_000,
      movingTime: 3_600,
      elevationMeters: 200,
      startDateLocal: "2026-05-01T08:00:00",
      regionIds: [10, 20],
      bbox: [-74.1, 40.6, -73.8, 40.9],
    };
    mockGet.mockResolvedValue({ data: { activities: [activity] } });

    expect(await fetchMapDataset()).toEqual([activity]);
  });

  it("coerces protojson int64-as-string ids (activityId, regionIds) to numbers", async () => {
    // protojson serializes int64 fields as JSON strings; the cross-filter compares
    // them against the MVT tile's numeric activity_id, so they must be parsed.
    mockGet.mockResolvedValue({
      data: {
        activities: [
          {
            activityId: "12345678901",
            name: "Big ID Ride",
            sport: "cycling",
            distanceMeters: 30_000,
            movingTime: 3_600,
            startDateLocal: "2026-05-01T08:00:00",
            regionIds: ["10", "20"],
          },
        ],
      },
    });

    const [a] = await fetchMapDataset();
    expect(a!.activityId).toBe(12345678901);
    expect(typeof a!.activityId).toBe("number");
    expect(a!.regionIds).toEqual([10, 20]);
    expect(a!.regionIds.every((id) => typeof id === "number")).toBe(true);
  });

  it("null-coalesces a missing/partial body to an empty list", async () => {
    mockGet.mockResolvedValue({ data: undefined });

    expect(await fetchMapDataset()).toEqual([]);
  });

  it("restores protojson-omitted zero/empty scalars to their defaults", async () => {
    // protojson drops zero/empty fields; the schema fills them so downstream
    // aggregations never see `undefined`/`NaN` (belt to mapInsights' suspenders).
    mockGet.mockResolvedValue({
      data: { activities: [{ activityId: "7", startDateLocal: "2026-05-01T08:00:00" }] },
    });

    const [a] = await fetchMapDataset();
    expect(a).toEqual({
      activityId: 7,
      name: "",
      sport: "",
      distanceMeters: 0,
      movingTime: 0,
      startDateLocal: "2026-05-01T08:00:00",
      regionIds: [],
    });
  });

  it("rejects a malformed activityId rather than coercing it to NaN", async () => {
    // `Number("not-an-id")` → NaN would silently never match the tile's numeric id;
    // the schema fails loudly through throwApiError instead.
    mockGet.mockResolvedValue({
      data: { activities: [{ activityId: "not-an-id", startDateLocal: "2026-05-01T08:00:00" }] },
    });

    await expect(fetchMapDataset()).rejects.toThrow("throwApiError:fetchMapDataset");
  });

  it("rejects an out-of-2^53 int64 string rather than silently rounding it", async () => {
    // "9007199254740993" (2^53 + 1) passes the digit regex but `Number(...)` rounds
    // it to 9007199254740992, an id that would never match the tile — so the safe-
    // integer guard must fail loudly instead of coercing to a rounded value.
    mockGet.mockResolvedValue({
      data: {
        activities: [{ activityId: "9007199254740993", startDateLocal: "2026-05-01T08:00:00" }],
      },
    });

    await expect(fetchMapDataset()).rejects.toThrow("throwApiError:fetchMapDataset");
  });

  it("rejects a malformed regionId rather than silently dropping a NaN", async () => {
    mockGet.mockResolvedValue({
      data: {
        activities: [
          { activityId: "7", startDateLocal: "2026-05-01T08:00:00", regionIds: ["10", "oops"] },
        ],
      },
    });

    await expect(fetchMapDataset()).rejects.toThrow("throwApiError:fetchMapDataset");
  });

  it("routes errors through throwApiError with the function context", async () => {
    mockGet.mockRejectedValue(new Error("network"));

    await expect(fetchMapDataset()).rejects.toThrow("throwApiError:fetchMapDataset");
    expect(throwApiError).toHaveBeenCalledWith(expect.any(Error), "fetchMapDataset");
  });
});
