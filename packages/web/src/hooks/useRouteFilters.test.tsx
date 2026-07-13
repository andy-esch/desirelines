import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { MapActivity } from "../api/map";
import type { RouteFilterState } from "../utils/routeFilters";
import { useRouteFilters } from "./useRouteFilters";

const NOW = new Date("2026-06-22T12:00:00");

function act_(over: Partial<MapActivity> = {}): MapActivity {
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

const DATASET: MapActivity[] = [
  act_({
    activityId: 1,
    sport: "cycling",
    distanceMeters: 30_000,
    startDateLocal: "2026-05-01T08:00:00",
    regionIds: [10],
  }),
  act_({
    activityId: 2,
    sport: "running",
    distanceMeters: 10_000,
    startDateLocal: "2026-02-10T08:00:00",
    regionIds: [20],
  }),
  act_({
    activityId: 3,
    sport: "cycling",
    distanceMeters: 80_000,
    startDateLocal: "2025-08-01T08:00:00",
    regionIds: [10],
  }),
];

function setup(activities = DATASET) {
  return renderHook(() => useRouteFilters(activities, { now: NOW }));
}

describe("useRouteFilters", () => {
  it("defaults to the current year, all sports/regions, no distance constraint", () => {
    const { result } = setup();
    expect(result.current.filters.dateRange).toEqual(["2026-01-01", "2026-06-22"]);
    expect(result.current.filters.sports).toEqual([]);
    expect(result.current.filters.regionId).toBeNull();
    expect(result.current.filters.distanceRange).toBeNull();
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.isFiltered).toBe(false);
  });

  it("filters to the current-year activities by default (excludes 2025)", () => {
    const { result } = setup();
    expect(result.current.filteredIds).toEqual([1, 2]);
    expect(result.current.totals.count).toBe(2);
    expect(result.current.totals.distanceMeters).toBe(40_000);
  });

  it("derives slider domains over the FULL dataset, not the filtered set", () => {
    const { result } = setup();
    // Distance max comes from the 2025 activity even though it's filtered out.
    expect(result.current.distanceDomain).toEqual([0, 80_000]);
    expect(result.current.dateDomain).toEqual(["2025-08-01", "2026-06-22"]);
  });

  it("toggleSport adds then removes a sport and bumps the active count", () => {
    const { result } = setup();
    act(() => result.current.toggleSport("cycling"));
    expect(result.current.filters.sports).toEqual(["cycling"]);
    expect(result.current.filteredIds).toEqual([1]); // only the 2026 cycling ride
    expect(result.current.activeFilterCount).toBe(1);
    act(() => result.current.toggleSport("cycling"));
    expect(result.current.filters.sports).toEqual([]);
    expect(result.current.activeFilterCount).toBe(0);
  });

  it("selectYear sets the date window and counts as an active filter", () => {
    const { result } = setup();
    act(() => result.current.selectYear(2025));
    expect(result.current.filters.dateRange).toEqual(["2025-01-01", "2025-12-31"]);
    expect(result.current.filteredIds).toEqual([3]);
    expect(result.current.activeFilterCount).toBe(1);
  });

  it("setDistanceRange constrains the set", () => {
    const { result } = setup();
    act(() => result.current.setDistanceRange([20_000, 100_000]));
    expect(result.current.filteredIds).toEqual([1]); // running (10k) drops out
    expect(result.current.activeFilterCount).toBe(1);
  });

  it("exposes a null mapFilter for an empty dataset, an id-set filter otherwise", () => {
    const empty = setup([]);
    expect(empty.result.current.mapFilter).toBeNull();
    const { result } = setup();
    expect(result.current.mapFilter).toEqual(["in", ["get", "activity_id"], ["literal", [1, 2]]]);
  });

  it("showAll widens the date window to the full domain and clears other filters", () => {
    const { result } = setup();
    act(() => {
      result.current.toggleSport("cycling");
      result.current.setRegionId(20);
    });
    act(() => result.current.showAll());
    // Full date domain (incl. the 2025 activity) → all three surface.
    expect(result.current.filters.dateRange).toEqual(["2025-08-01", "2026-06-22"]);
    expect(result.current.filters.sports).toEqual([]);
    expect(result.current.filters.regionId).toBeNull();
    expect(result.current.filteredIds).toEqual([1, 2, 3]);
  });

  it("reset restores every dimension to the defaults", () => {
    const { result } = setup();
    act(() => {
      result.current.toggleSport("running");
      result.current.setDistanceRange([0, 5_000]);
      result.current.setRegionId(20);
    });
    expect(result.current.activeFilterCount).toBeGreaterThan(0);
    act(() => result.current.reset());
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.filters).toEqual({
      sports: [],
      distanceRange: null,
      dateRange: ["2026-01-01", "2026-06-22"],
      regionId: null,
    });
  });

  describe("controlled mode (value + onChange)", () => {
    const baseValue: RouteFilterState = {
      sports: [],
      distanceRange: null,
      dateRange: ["2026-01-01", "2026-06-22"],
      regionId: null,
    };

    it("reads filters from `value` and routes setters through `onChange`", () => {
      const onChange = vi.fn();
      const { result } = renderHook(() =>
        useRouteFilters(DATASET, { now: NOW, value: baseValue, onChange })
      );
      expect(result.current.filters).toEqual(baseValue);
      act(() => result.current.toggleSport("cycling"));
      // Setter emits the next state; it does NOT mutate internal state (parent owns it).
      expect(onChange).toHaveBeenCalledWith({ ...baseValue, sports: ["cycling"] });
      expect(result.current.filters.sports).toEqual([]);
    });

    it("computes functional updates from the latest `value` prop", () => {
      const onChange = vi.fn();
      const { result, rerender } = renderHook(
        ({ value }) => useRouteFilters(DATASET, { now: NOW, value, onChange }),
        { initialProps: { value: { ...baseValue, sports: ["cycling"] } } }
      );
      const updated: RouteFilterState = { ...baseValue, sports: ["cycling", "running"] };
      rerender({ value: updated });
      act(() => result.current.setRegionId(10));
      expect(onChange).toHaveBeenCalledWith({ ...updated, regionId: 10 });
    });
  });
});
