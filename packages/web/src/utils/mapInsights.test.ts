import { describe, it, expect } from "vitest";
import type { MapActivity } from "../api/map";
import {
  sportBreakdown,
  breakdownValue,
  rankedSportBreakdown,
  weeklyVolume,
  cumulativeDistance,
  distanceHistogram,
  regionBreakdown,
} from "./mapInsights";

function act(over: Partial<MapActivity> = {}): MapActivity {
  return {
    activityId: 1,
    name: "x",
    sport: "cycling",
    distanceMeters: 10_000,
    movingTime: 3_600,
    elevationMeters: 100,
    startDateLocal: "2026-05-01T08:00:00",
    regionIds: [],
    ...over,
  };
}

const DATA: MapActivity[] = [
  act({ activityId: 1, sport: "cycling", distanceMeters: 30_000, movingTime: 3_600 }),
  act({ activityId: 2, sport: "cycling", distanceMeters: 20_000, movingTime: 1_800 }),
  act({ activityId: 3, sport: "running", distanceMeters: 10_000, movingTime: 3_000 }),
];

describe("mapInsights", () => {
  it("aggregates per sport (count + sums)", () => {
    const rows = sportBreakdown(DATA);
    const cycling = rows.find((r) => r.sport === "cycling")!;
    expect(cycling.count).toBe(2);
    expect(cycling.distanceMeters).toBe(50_000);
    expect(cycling.movingTimeSeconds).toBe(5_400);
    expect(rows.find((r) => r.sport === "running")!.count).toBe(1);
  });

  it("breakdownValue picks the metric", () => {
    const [cycling] = rankedSportBreakdown(DATA, "distance");
    expect(breakdownValue(cycling!, "distance")).toBe(50_000);
    expect(breakdownValue(cycling!, "time")).toBe(5_400);
    expect(breakdownValue(cycling!, "count")).toBe(2);
  });

  it("ranks descending by the chosen metric", () => {
    // By distance, cycling (50k) leads running (10k).
    expect(rankedSportBreakdown(DATA, "distance").map((r) => r.sport)).toEqual([
      "cycling",
      "running",
    ]);
    // By count, cycling (2) still leads running (1).
    expect(rankedSportBreakdown(DATA, "count")[0]!.sport).toBe("cycling");
  });

  it("returns an empty array for no activities", () => {
    expect(sportBreakdown([])).toEqual([]);
  });

  it("buckets weekly volume by ISO week (Monday), ascending", () => {
    const data = [
      // 2026-05-04 is a Monday; 2026-05-06 is the same ISO week.
      act({ activityId: 1, startDateLocal: "2026-05-04T08:00:00", distanceMeters: 10_000 }),
      act({ activityId: 2, startDateLocal: "2026-05-06T08:00:00", distanceMeters: 5_000 }),
      // 2026-05-11 is the next Monday → a separate week.
      act({ activityId: 3, startDateLocal: "2026-05-11T08:00:00", distanceMeters: 7_000 }),
    ];
    const weeks = weeklyVolume(data);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-05-04", "2026-05-11"]);
    expect(weeks[0]!.distanceMeters).toBe(15_000);
    expect(weeks[0]!.count).toBe(2);
    expect(weeks[1]!.distanceMeters).toBe(7_000);
  });

  it("computes a daily cumulative distance total, ascending by date", () => {
    const data = [
      act({ activityId: 1, startDateLocal: "2026-05-02T08:00:00", distanceMeters: 5_000 }),
      act({ activityId: 2, startDateLocal: "2026-05-01T08:00:00", distanceMeters: 10_000 }),
      act({ activityId: 3, startDateLocal: "2026-05-01T18:00:00", distanceMeters: 2_000 }),
    ];
    expect(cumulativeDistance(data)).toEqual([
      { date: "2026-05-01", cumulativeMeters: 12_000 }, // both 05-01 activities summed
      { date: "2026-05-02", cumulativeMeters: 17_000 }, // running total
    ]);
  });

  it("drops dateless activities instead of bucketing them into a phantom 1969 point", () => {
    // A defaulted "" start_date_local would fall back to the epoch: a 1969-12-29
    // week bar in weeklyVolume and a ""-keyed point that sorts first in
    // cumulativeDistance. Both aggregations must skip the row entirely.
    const data = [
      act({ activityId: 1, startDateLocal: "", distanceMeters: 9_000 }),
      act({ activityId: 2, startDateLocal: "2026-05-04T08:00:00", distanceMeters: 10_000 }),
    ];

    const weeks = weeklyVolume(data);
    expect(weeks.map((w) => w.weekStart)).toEqual(["2026-05-04"]); // no 1969 bar
    expect(weeks[0]!.distanceMeters).toBe(10_000); // dateless 9k excluded
    expect(weeks[0]!.count).toBe(1);

    expect(cumulativeDistance(data)).toEqual([
      { date: "2026-05-04", cumulativeMeters: 10_000 }, // no leading "" point
    ]);
  });

  it("bins distances into nice-width buckets", () => {
    const data = [
      act({ activityId: 1, distanceMeters: 1_000 }),
      act({ activityId: 2, distanceMeters: 4_000 }),
      act({ activityId: 3, distanceMeters: 9_500 }),
    ];
    const bins = distanceHistogram(data);
    // max 9,500 → niceStep(9500/8 ≈ 1187) = 2000 → bins of 2 km.
    expect(bins[0]).toEqual({ start: 0, end: 2_000, count: 1 }); // the 1 km activity
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(3); // every activity binned once
    expect(bins.at(-1)!.count).toBe(1); // the 9.5 km activity in the last bin
  });

  it("returns no bins when there's no positive distance", () => {
    expect(distanceHistogram([])).toEqual([]);
    expect(distanceHistogram([act({ distanceMeters: 0 })])).toEqual([]);
  });

  it("is robust to malformed rows (negative/NaN distance, missing regionIds/movingTime)", () => {
    const bad = [
      act({ activityId: 1, distanceMeters: -500, movingTime: undefined as never }),
      act({ activityId: 2, distanceMeters: NaN, regionIds: undefined as never }),
      act({ activityId: 3, distanceMeters: 5_000, regionIds: [10] }),
    ];
    // distanceHistogram skips the negative/NaN rows (no out-of-bounds crash).
    expect(distanceHistogram(bad).reduce((n, b) => n + b.count, 0)).toBe(1); // only the 5km row
    // sportBreakdown doesn't produce NaN from a null movingTime.
    expect(sportBreakdown(bad).every((r) => Number.isFinite(r.movingTimeSeconds))).toBe(true);
    // regionBreakdown survives a missing regionIds array.
    expect(() => regionBreakdown(bad)).not.toThrow();
    expect(regionBreakdown(bad).find((r) => r.regionId === 10)?.count).toBe(1);
  });

  it("aggregates per region (an activity counts in each of its regions)", () => {
    const data = [
      act({ activityId: 1, regionIds: [10, 20], distanceMeters: 5_000 }),
      act({ activityId: 2, regionIds: [10], distanceMeters: 3_000 }),
    ];
    const rows = regionBreakdown(data);
    expect(rows.find((r) => r.regionId === 10)).toEqual({
      regionId: 10,
      count: 2,
      distanceMeters: 8_000,
    });
    expect(rows.find((r) => r.regionId === 20)).toEqual({
      regionId: 20,
      count: 1,
      distanceMeters: 5_000,
    });
  });
});
