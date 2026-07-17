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

// Every activity inside the current year, so the default window spans the whole
// date domain and therefore constrains nothing. Isolates "date is not active".
const SINGLE_YEAR: MapActivity[] = [
  act_({ activityId: 1, sport: "cycling", startDateLocal: "2026-05-01T08:00:00" }),
  act_({ activityId: 2, sport: "running", startDateLocal: "2026-02-10T08:00:00" }),
];

describe("useRouteFilters", () => {
  it("defaults to the current year, all sports/regions, no distance constraint", () => {
    const { result } = setup();
    expect(result.current.filters.dateRange).toEqual(["2026-01-01", "2026-06-22"]);
    expect(result.current.filters.sports).toEqual([]);
    expect(result.current.filters.regionId).toBeNull();
    expect(result.current.filters.distanceRange).toBeNull();
    // DATASET spans back to 2025, so the current-year default genuinely excludes
    // data — "active" is measured against the domain, so it counts. See the
    // SINGLE_YEAR case below for the same default reading 0 when it excludes nothing.
    expect(result.current.activeFilterCount).toBe(1);
    expect(result.current.isFiltered).toBe(true);
  });

  it("reads 0 active filters on a fresh load when the default year IS the whole domain", () => {
    const { result } = renderHook(() => useRouteFilters(SINGLE_YEAR, { now: NOW }));
    expect(result.current.dateDomain).toEqual(["2026-02-10", "2026-06-22"]);
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
    // Counts are 2/1 rather than 1/0 because DATASET's current-year default already
    // constrains the date domain — the sport toggle is the delta being asserted.
    act(() => result.current.toggleSport("cycling"));
    expect(result.current.filters.sports).toEqual(["cycling"]);
    expect(result.current.filteredIds).toEqual([1]); // only the 2026 cycling ride
    expect(result.current.activeFilterCount).toBe(2); // sport + date
    act(() => result.current.toggleSport("cycling"));
    expect(result.current.filters.sports).toEqual([]);
    expect(result.current.activeFilterCount).toBe(1); // date only
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
    expect(result.current.activeFilterCount).toBe(2); // distance + DATASET's default date
  });

  it("a distance slider parked at the full domain is not an active filter", () => {
    const { result } = renderHook(() => useRouteFilters(SINGLE_YEAR, { now: NOW }));
    const [lo, hi] = result.current.distanceDomain;
    act(() => result.current.setDistanceRange([lo, hi]));
    expect(result.current.activeFilterCount).toBe(0);
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

  it("showAll leaves zero active filters — the un-filter action must not look filtered", () => {
    const { result } = setup();
    act(() => result.current.toggleSport("cycling"));
    act(() => result.current.showAll());
    // showAll widens date to the full domain, which excludes nothing. Previously the
    // date branch compared against the default current-year range, so this reported a
    // phantom active filter (and a Reset affordance) for a view that filters nothing.
    expect(result.current.filteredIds).toEqual([1, 2, 3]);
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.isFiltered).toBe(false);
  });

  it("canReset tracks 'reset would change something', not 'the view is constrained'", () => {
    const { result } = setup();
    // Fresh load: the current-year default constrains DATASET's 2025 data (count 1)
    // but IS the default, so reset is a no-op. This pairing is the whole reason
    // canReset exists separately — gating a Reset affordance on activeFilterCount
    // would render a button that does nothing.
    expect(result.current.activeFilterCount).toBe(1);
    expect(result.current.canReset).toBe(false);

    // showAll: constrains nothing (count 0) yet reset would narrow back to this
    // year — the exact inverse.
    act(() => result.current.showAll());
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.canReset).toBe(true);

    // Back to defaults → nothing to reset again.
    act(() => result.current.reset());
    expect(result.current.canReset).toBe(false);
  });

  it("canReset flips for any non-default dimension", () => {
    const { result } = setup();
    act(() => result.current.toggleSport("cycling"));
    expect(result.current.canReset).toBe(true);
    act(() => result.current.toggleSport("cycling"));
    expect(result.current.canReset).toBe(false);

    act(() => result.current.setRegionId(20));
    expect(result.current.canReset).toBe(true);
    act(() => result.current.setRegionId(null));
    expect(result.current.canReset).toBe(false);

    // distanceRange defaults to null, so any range at all is non-default.
    act(() => result.current.setDistanceRange([0, 80_000]));
    expect(result.current.canReset).toBe(true);
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
    // reset restores the current-year default, which still constrains DATASET's
    // 2025 data — hence 1, not 0. Use showAll() for a genuinely unfiltered view.
    expect(result.current.activeFilterCount).toBe(1);
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
