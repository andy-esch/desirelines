import { describe, it, expect } from "vitest";
import type { MapActivity } from "../api/map";
import {
  toLocalDate,
  todayLocal,
  yearRange,
  defaultRouteFilters,
  activityDistanceDomain,
  activityDateDomain,
  matchesFilters,
  filterMapActivities,
  buildActivityIdFilter,
  summarizeMapActivities,
  mapPresetSports,
  type RouteFilterState,
} from "./routeFilters";

const NOW = new Date("2026-06-22T12:00:00");

function act(over: Partial<MapActivity> = {}): MapActivity {
  return {
    activityId: 1,
    name: "Morning Ride",
    sport: "cycling",
    distanceMeters: 30_000,
    movingTime: 3_600,
    elevationMeters: 200,
    startDateLocal: "2026-05-01T08:00:00",
    regionIds: [10],
    ...over,
  };
}

describe("date helpers", () => {
  it("takes the local date portion without TZ conversion", () => {
    expect(toLocalDate("2026-05-01T23:30:00")).toBe("2026-05-01");
  });

  it("formats today as YYYY-MM-DD", () => {
    expect(todayLocal(NOW)).toBe("2026-06-22");
  });

  it("clamps the current year to today, full year otherwise", () => {
    expect(yearRange(2026, NOW)).toEqual(["2026-01-01", "2026-06-22"]);
    expect(yearRange(2025, NOW)).toEqual(["2025-01-01", "2025-12-31"]);
  });
});

describe("defaultRouteFilters", () => {
  it("defaults to the current year, all sports/regions, no distance constraint", () => {
    expect(defaultRouteFilters(NOW)).toEqual({
      sports: [],
      distanceRange: null,
      dateRange: ["2026-01-01", "2026-06-22"],
      regionId: null,
    });
  });
});

describe("domains", () => {
  it("computes the distance domain as [0, max]", () => {
    expect(
      activityDistanceDomain([act({ distanceMeters: 10_000 }), act({ distanceMeters: 50_000 })])
    ).toEqual([0, 50_000]);
    expect(activityDistanceDomain([])).toEqual([0, 0]);
  });

  it("computes the date domain as [earliest, today]", () => {
    expect(
      activityDateDomain(
        [
          act({ startDateLocal: "2024-03-02T00:00:00" }),
          act({ startDateLocal: "2026-01-01T00:00:00" }),
        ],
        NOW
      )
    ).toEqual(["2024-03-02", "2026-06-22"]);
    expect(activityDateDomain([], NOW)).toEqual(["2026-06-22", "2026-06-22"]);
  });

  it("skips dateless activities instead of letting them anchor the domain", () => {
    // MapActivitySchema defaults startDateLocal to "" when protojson omits it, and
    // "" < "2024-03-02" in string ordering — so without a guard one dateless row
    // drags the slider domain back to the empty string.
    expect(
      activityDateDomain(
        [
          act({ startDateLocal: "" }),
          act({ startDateLocal: "2024-03-02T00:00:00" }),
          act({ startDateLocal: "2026-01-01T00:00:00" }),
        ],
        NOW
      )
    ).toEqual(["2024-03-02", "2026-06-22"]);
  });

  it("falls back to [today, today] when every activity is dateless", () => {
    expect(
      activityDateDomain([act({ startDateLocal: "" }), act({ startDateLocal: "" })], NOW)
    ).toEqual(["2026-06-22", "2026-06-22"]);
  });
});

describe("matchesFilters", () => {
  const base = defaultRouteFilters(NOW);

  it("passes an in-range activity at defaults", () => {
    expect(matchesFilters(act(), base)).toBe(true);
  });

  it("filters by sport category (empty = all)", () => {
    expect(matchesFilters(act({ sport: "running" }), { ...base, sports: ["cycling"] })).toBe(false);
    expect(matchesFilters(act({ sport: "cycling" }), { ...base, sports: ["cycling"] })).toBe(true);
    expect(matchesFilters(act({ sport: "running" }), { ...base, sports: [] })).toBe(true);
  });

  it("filters by distance range (inclusive)", () => {
    const f: RouteFilterState = { ...base, distanceRange: [20_000, 40_000] };
    expect(matchesFilters(act({ distanceMeters: 30_000 }), f)).toBe(true);
    expect(matchesFilters(act({ distanceMeters: 20_000 }), f)).toBe(true);
    expect(matchesFilters(act({ distanceMeters: 10_000 }), f)).toBe(false);
    expect(matchesFilters(act({ distanceMeters: 50_000 }), f)).toBe(false);
  });

  it("filters by date range (inclusive, local date)", () => {
    const f: RouteFilterState = { ...base, dateRange: ["2026-04-01", "2026-05-31"] };
    expect(matchesFilters(act({ startDateLocal: "2026-05-01T08:00:00" }), f)).toBe(true);
    expect(matchesFilters(act({ startDateLocal: "2026-03-31T23:59:00" }), f)).toBe(false);
    expect(matchesFilters(act({ startDateLocal: "2026-06-01T00:00:00" }), f)).toBe(false);
  });

  it("filters by region membership (null = all)", () => {
    expect(matchesFilters(act({ regionIds: [10, 20] }), { ...base, regionId: 20 })).toBe(true);
    expect(matchesFilters(act({ regionIds: [10] }), { ...base, regionId: 99 })).toBe(false);
    expect(matchesFilters(act({ regionIds: [] }), { ...base, regionId: null })).toBe(true);
  });
});

describe("filterMapActivities", () => {
  it("returns only the passing subset", () => {
    const acts = [
      act({ activityId: 1, sport: "cycling" }),
      act({ activityId: 2, sport: "running" }),
      act({ activityId: 3, sport: "cycling" }),
    ];
    const result = filterMapActivities(acts, { ...defaultRouteFilters(NOW), sports: ["cycling"] });
    expect(result.map((a) => a.activityId)).toEqual([1, 3]);
  });
});

describe("buildActivityIdFilter", () => {
  it("builds an 'in' expression over the tile activity_id property", () => {
    expect(buildActivityIdFilter([1, 2, 3])).toEqual([
      "in",
      ["get", "activity_id"],
      ["literal", [1, 2, 3]],
    ]);
  });

  it("hides everything for an empty set", () => {
    expect(buildActivityIdFilter([])).toEqual(["in", ["get", "activity_id"], ["literal", []]]);
  });
});

describe("summarizeMapActivities", () => {
  it("sums count/distance/time/elevation, treating missing elevation as 0", () => {
    // Second activity omits elevationMeters (optional) to exercise the `?? 0` path.
    const noElevation: MapActivity = {
      activityId: 2,
      name: "Evening Spin",
      sport: "cycling",
      distanceMeters: 20_000,
      movingTime: 2_000,
      startDateLocal: "2026-05-01T08:00:00",
      regionIds: [],
    };
    expect(
      summarizeMapActivities([
        act({ distanceMeters: 10_000, movingTime: 1_000, elevationMeters: 100 }),
        noElevation,
      ])
    ).toEqual({
      count: 2,
      distanceMeters: 30_000,
      movingTimeSeconds: 3_000,
      elevationMeters: 100,
    });
  });

  it("is zeroed for an empty set", () => {
    expect(summarizeMapActivities([])).toEqual({
      count: 0,
      distanceMeters: 0,
      movingTimeSeconds: 0,
      elevationMeters: 0,
    });
  });
});

describe("mapPresetSports", () => {
  it("keeps only preferred sports present in the dataset", () => {
    expect(mapPresetSports(["cycling", "running", "swimming"], ["cycling", "swimming"])).toEqual([
      "cycling",
      "swimming",
    ]);
  });

  it("drops a preferred sport with no geo-bearing activities on the map", () => {
    // User opted into hiking app-wide but has no hikes with route geometry.
    expect(mapPresetSports(["cycling", "hiking"], ["cycling"])).toEqual(["cycling"]);
  });

  it("returns empty when none of the preferred sports are present", () => {
    expect(mapPresetSports(["hiking"], ["cycling", "running"])).toEqual([]);
  });

  it("returns empty for an empty preference", () => {
    expect(mapPresetSports([], ["cycling"])).toEqual([]);
  });

  it("preserves the preference's order, not the dataset's", () => {
    expect(mapPresetSports(["running", "cycling"], ["cycling", "running"])).toEqual([
      "running",
      "cycling",
    ]);
  });
});
