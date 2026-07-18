import { describe, it, expect } from "vitest";
import {
  aggregateActivities,
  toChartData,
  filterBucketsByType,
  monthsInRange,
} from "./activityBuckets";
import type { ActivitySummary } from "../api/activities";

function activity(over: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id: 1,
    name: "Activity",
    sport: "cycling",
    startDateLocal: "2026-05-10T08:00:00",
    distanceMeters: 30_000,
    movingTimeSeconds: 3_600,
    hasRoute: true,
    ...over,
  } as ActivitySummary;
}

describe("aggregateActivities", () => {
  it("returns an empty array for no activities", () => {
    expect(aggregateActivities([])).toEqual([]);
  });

  it("groups by month × sport × geographic and sums the measures", () => {
    const buckets = aggregateActivities([
      activity({
        startDateLocal: "2026-05-01T08:00:00",
        distanceMeters: 10_000,
        movingTimeSeconds: 1_000,
      }),
      activity({
        startDateLocal: "2026-05-20T08:00:00",
        distanceMeters: 20_000,
        movingTimeSeconds: 2_000,
      }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toEqual({
      month: "2026-05",
      sport: "cycling",
      geographic: true,
      count: 2,
      movingTimeSeconds: 3_000,
      distanceMeters: 30_000,
    });
  });

  it("splits geographic from non-geographic even for the same month+sport", () => {
    const buckets = aggregateActivities([
      activity({ sport: "cycling", hasRoute: true }),
      activity({ sport: "cycling", hasRoute: false }),
    ]);
    expect(buckets).toHaveLength(2);
    expect(buckets.map((b) => b.geographic)).toEqual([false, true]); // false sorts first
    expect(buckets.every((b) => b.count === 1)).toBe(true);
  });

  it("keeps a zero-distance sport (yoga) visible via count and time", () => {
    const buckets = aggregateActivities([
      activity({ sport: "yoga", hasRoute: false, distanceMeters: 0, movingTimeSeconds: 1_800 }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      sport: "yoga",
      geographic: false,
      count: 1,
      distanceMeters: 0,
      movingTimeSeconds: 1_800,
    });
  });

  it("buckets by athlete-local month without a timezone shift", () => {
    // 00:30 local on the 1st must stay in May, not roll back to April via UTC.
    const buckets = aggregateActivities([activity({ startDateLocal: "2026-05-01T00:30:00" })]);
    expect(buckets[0]!.month).toBe("2026-05");
  });

  it("separates activities across month boundaries", () => {
    const buckets = aggregateActivities([
      activity({ startDateLocal: "2026-04-30T23:00:00" }),
      activity({ startDateLocal: "2026-05-01T01:00:00" }),
    ]);
    expect(buckets.map((b) => b.month)).toEqual(["2026-04", "2026-05"]);
  });

  it("returns buckets sorted by month, then sport, then geographic", () => {
    const buckets = aggregateActivities([
      activity({ startDateLocal: "2026-06-01T08:00:00", sport: "running" }),
      activity({ startDateLocal: "2026-05-01T08:00:00", sport: "yoga", hasRoute: false }),
      activity({ startDateLocal: "2026-05-01T08:00:00", sport: "cycling" }),
    ]);
    expect(buckets.map((b) => `${b.month}/${b.sport}`)).toEqual([
      "2026-05/cycling",
      "2026-05/yoga",
      "2026-06/running",
    ]);
  });

  it("totals reconcile: summed bucket counts equal the input length", () => {
    const input = [
      activity({ sport: "cycling", hasRoute: true }),
      activity({ sport: "running", hasRoute: true }),
      activity({ sport: "yoga", hasRoute: false, distanceMeters: 0 }),
      activity({ startDateLocal: "2026-06-01T08:00:00", sport: "cycling", hasRoute: false }),
    ];
    const total = aggregateActivities(input).reduce((n, b) => n + b.count, 0);
    expect(total).toBe(input.length);
  });

  it("skips activities with an unusable startDateLocal rather than forming a junk bucket", () => {
    const buckets = aggregateActivities([
      activity({ startDateLocal: "" }),
      activity({ startDateLocal: "2026-05-10T08:00:00" }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.month).toBe("2026-05");
  });
});

describe("toChartData", () => {
  const buckets = [
    {
      month: "2026-05",
      sport: "cycling",
      geographic: true,
      count: 2,
      movingTimeSeconds: 7200,
      distanceMeters: 60000,
    },
    {
      month: "2026-05",
      sport: "yoga",
      geographic: false,
      count: 1,
      movingTimeSeconds: 1800,
      distanceMeters: 0,
    },
    {
      month: "2026-06",
      sport: "cycling",
      geographic: true,
      count: 1,
      movingTimeSeconds: 3600,
      distanceMeters: 30000,
    },
  ];

  it("makes one row per month with every sport series present (0 where absent)", () => {
    const { rows } = toChartData(buckets, "count");
    expect(rows.map((r) => r.month)).toEqual(["2026-05", "2026-06"]);
    // June has no yoga → its yoga series must still be present and 0.
    // Row keys are namespaced "s:<sport>" so they can't collide with "month".
    expect(rows[1]!["s:yoga"]).toBe(0);
    expect(rows[0]!["s:cycling"]).toBe(2);
    expect(rows[0]!["s:yoga"]).toBe(1);
  });

  it("stacks by sport (alphabetical), combining geographic + non-geographic of a sport", () => {
    const mixed = [
      {
        month: "2026-05",
        sport: "cycling",
        geographic: true,
        count: 2,
        movingTimeSeconds: 0,
        distanceMeters: 0,
      },
      {
        month: "2026-05",
        sport: "cycling",
        geographic: false,
        count: 3,
        movingTimeSeconds: 0,
        distanceMeters: 0,
      },
    ];
    const { rows, series } = toChartData(mixed, "count");
    expect(series.map((s) => s.key)).toEqual(["s:cycling"]);
    expect(series.map((s) => s.sport)).toEqual(["cycling"]);
    expect(rows[0]!["s:cycling"]).toBe(5); // 2 geo + 3 indoor summed into one sport segment
  });

  it("fills empty months across the given month axis (flat at zero)", () => {
    const { rows } = toChartData(buckets, "count", [
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(rows.map((r) => r.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(rows[0]!["s:cycling"]).toBe(0); // January present but empty
    expect(rows[4]!["s:cycling"]).toBe(2); // May has data
  });

  it("returns empty rows and series for no buckets", () => {
    expect(toChartData([], "count")).toEqual({ rows: [], series: [] });
  });
});

describe("filterBucketsByType", () => {
  const buckets = [
    {
      month: "2026-05",
      sport: "cycling",
      geographic: true,
      count: 1,
      movingTimeSeconds: 0,
      distanceMeters: 0,
    },
    {
      month: "2026-05",
      sport: "yoga",
      geographic: false,
      count: 1,
      movingTimeSeconds: 0,
      distanceMeters: 0,
    },
  ];
  it("keeps everything for 'all'", () => {
    expect(filterBucketsByType(buckets, "all")).toHaveLength(2);
  });
  it("keeps only geographic for 'outdoor'", () => {
    expect(filterBucketsByType(buckets, "outdoor").map((b) => b.sport)).toEqual(["cycling"]);
  });
  it("keeps only non-geographic for 'indoor'", () => {
    expect(filterBucketsByType(buckets, "indoor").map((b) => b.sport)).toEqual(["yoga"]);
  });
});

describe("monthsInRange", () => {
  it("enumerates YYYY-MM inclusive across a year boundary", () => {
    expect(monthsInRange("2025-11-15", "2026-02-03")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
  it("returns a single month when from and to share it", () => {
    expect(monthsInRange("2026-05-01", "2026-05-31")).toEqual(["2026-05"]);
  });
  it("returns [] for an unbounded range (missing bound)", () => {
    expect(monthsInRange(undefined, "2026-05-01")).toEqual([]);
    expect(monthsInRange("2026-01-01", undefined)).toEqual([]);
  });
});
