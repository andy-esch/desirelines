import { describe, it, expect } from "vitest";
import { filterDemoActivities } from "./demoActivityFilter";
import type { ActivitySummary } from "../api/activities";

const act = (id: number, sport: string, startDateLocal: string): ActivitySummary => ({
  id: String(id),
  name: `Activity ${id}`,
  type: "Ride",
  sport,
  startDateLocal,
  distanceMeters: 1000,
  movingTimeSeconds: 600,
  hasRoute: false,
});

const ACTIVITIES = [
  act(1, "cycling", "2026-01-15T08:00:00"),
  act(2, "running", "2026-02-01T18:30:00"),
  act(3, "yoga", "2026-03-01T23:30:00"),
];

describe("filterDemoActivities", () => {
  it("returns everything when the filter is empty (all sports, all time)", () => {
    expect(filterDemoActivities(ACTIVITIES, {})).toEqual(ACTIVITIES);
    expect(filterDemoActivities(ACTIVITIES, { sports: [] })).toEqual(ACTIVITIES);
  });

  it("keeps only the selected sport categories", () => {
    const result = filterDemoActivities(ACTIVITIES, { sports: ["cycling", "yoga"] });
    expect(result.map((a) => a.sport)).toEqual(["cycling", "yoga"]);
  });

  it("applies the date window with inclusive bounds", () => {
    const result = filterDemoActivities(ACTIVITIES, { from: "2026-01-15", to: "2026-02-01" });
    expect(result.map((a) => a.id)).toEqual(["1", "2"]);
  });

  it("compares the local date as a string — no timezone shift on boundary days", () => {
    // 23:30 local on the `to` day: a UTC round-trip in a UTC-negative zone
    // would push this past the boundary; string comparison must keep it.
    const result = filterDemoActivities(ACTIVITIES, { from: "2026-03-01", to: "2026-03-01" });
    expect(result.map((a) => a.id)).toEqual(["3"]);
  });

  it("combines sport and date filters", () => {
    const result = filterDemoActivities(ACTIVITIES, {
      sports: ["running", "yoga"],
      from: "2026-01-01",
      to: "2026-02-28",
    });
    expect(result.map((a) => a.id)).toEqual(["2"]);
  });
});
