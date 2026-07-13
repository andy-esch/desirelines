import { describe, it, expect } from "vitest";
import {
  parseActivityFilterSearch,
  searchToFilters,
  filtersToSearch,
  type ActivityFilterSearch,
} from "./activityFilterSearch";
import { defaultRouteFilters } from "./routeFilters";
import type { RouteFilterState } from "./routeFilters";

const NOW = new Date("2026-06-22T12:00:00");
// defaultRouteFilters(NOW).dateRange === ["2026-01-01", "2026-06-22"]

describe("parseActivityFilterSearch", () => {
  it("keeps well-formed params and coerces numeric strings", () => {
    expect(
      parseActivityFilterSearch({
        sports: "cycling,running",
        from: "2025-01-01",
        to: "2025-12-31",
        dmin: "1000",
        dmax: "50000",
        region: "10",
      })
    ).toEqual({
      sports: "cycling,running",
      from: "2025-01-01",
      to: "2025-12-31",
      dmin: 1000,
      dmax: 50000,
      region: 10,
    });
  });

  it("drops junk: empty sports, non-numeric distance, non-integer region", () => {
    expect(
      parseActivityFilterSearch({ sports: "", dmin: "abc", dmax: "5", region: "1.5" })
    ).toEqual({});
  });

  it("keeps distance only when BOTH bounds are present (paired window)", () => {
    expect(parseActivityFilterSearch({ dmin: "1000" })).toEqual({});
    expect(parseActivityFilterSearch({ dmax: "1000" })).toEqual({});
    expect(parseActivityFilterSearch({ dmin: "1000", dmax: "2000" })).toEqual({
      dmin: 1000,
      dmax: 2000,
    });
  });

  it("drops malformed and impossible dates", () => {
    expect(parseActivityFilterSearch({ from: "oops", to: "2026-06-22" })).toEqual({
      to: "2026-06-22",
    });
    // 2026-02-31 rolls forward in the Date engine → rejected (would blank the date input).
    expect(parseActivityFilterSearch({ from: "2026-02-31" })).toEqual({});
  });

  it("orders a crossed date window", () => {
    expect(parseActivityFilterSearch({ from: "2026-06-22", to: "2026-01-01" })).toEqual({
      from: "2026-01-01",
      to: "2026-06-22",
    });
  });

  it("orders a crossed distance window (the slider never gets lo > hi)", () => {
    expect(parseActivityFilterSearch({ dmin: "5000", dmax: "1000" })).toEqual({
      dmin: 1000,
      dmax: 5000,
    });
  });

  it("ignores empty-string params (no region 0 from `?region=`)", () => {
    expect(parseActivityFilterSearch({ region: "", dmin: "", dmax: "" })).toEqual({});
  });
});

describe("searchToFilters", () => {
  it("returns the defaults for an empty search", () => {
    expect(searchToFilters({}, NOW)).toEqual(defaultRouteFilters(NOW));
  });

  it("fills only the provided dimensions, defaulting the rest", () => {
    expect(searchToFilters({ sports: "cycling", region: 10 }, NOW)).toEqual({
      sports: ["cycling"],
      dateRange: ["2026-01-01", "2026-06-22"], // default (untouched)
      distanceRange: null,
      regionId: 10,
    });
  });

  it("reconstructs the distance window from the paired bounds", () => {
    expect(searchToFilters({ dmin: 1000, dmax: 50000 }, NOW).distanceRange).toEqual([1000, 50000]);
  });
});

describe("filtersToSearch", () => {
  it("emits nothing when the filters are at their defaults (clean URL)", () => {
    expect(filtersToSearch(defaultRouteFilters(NOW), NOW)).toEqual({});
  });

  it("emits only the constrained dimensions", () => {
    const filters: RouteFilterState = {
      sports: ["cycling", "running"],
      dateRange: ["2025-01-01", "2025-12-31"],
      distanceRange: [1000, 50000],
      regionId: 10,
    };
    expect(filtersToSearch(filters, NOW)).toEqual({
      sports: "cycling,running",
      from: "2025-01-01",
      to: "2025-12-31",
      dmin: 1000,
      dmax: 50000,
      region: 10,
    });
  });

  it("omits the date bound that still equals the default (e.g. showAll keeps 'to')", () => {
    const filters: RouteFilterState = {
      ...defaultRouteFilters(NOW),
      dateRange: ["2024-03-01", "2026-06-22"], // 'to' == default today
    };
    expect(filtersToSearch(filters, NOW)).toEqual({ from: "2024-03-01" });
  });
});

describe("round-trip", () => {
  it("filters → search → filters is identity for arbitrary constrained state", () => {
    const filters: RouteFilterState = {
      sports: ["running", "hiking"],
      dateRange: ["2025-06-01", "2025-08-31"],
      distanceRange: [500, 12000],
      regionId: 42,
    };
    const round = searchToFilters(
      parseActivityFilterSearch(filtersToSearch(filters, NOW) as Record<string, unknown>),
      NOW
    );
    expect(round).toEqual(filters);
  });

  it("defaults round-trip to defaults through an empty search", () => {
    const def = defaultRouteFilters(NOW);
    const search: ActivityFilterSearch = filtersToSearch(def, NOW);
    expect(searchToFilters(search, NOW)).toEqual(def);
  });
});
