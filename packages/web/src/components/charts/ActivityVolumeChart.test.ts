import { describe, it, expect } from "vitest";
import { topOfStack } from "./ActivityVolumeChart";
import type { ChartData } from "../../utils/activityBuckets";

// Stacking order: the first series sits at the bottom of each month's bar.
const series: ChartData["series"] = [
  { key: "Ride", sport: "Ride" },
  { key: "Run", sport: "Run" },
  { key: "Swim", sport: "Swim" },
];

describe("topOfStack", () => {
  it("is the last series in stacking order", () => {
    expect(topOfStack({ month: "2026-05", Ride: 10, Run: 4, Swim: 2 }, series)).toBe("Swim");
  });

  it("skips series with no volume that month, so the visible top gets the corners", () => {
    expect(topOfStack({ month: "2026-05", Ride: 10, Run: 4, Swim: 0 }, series)).toBe("Run");
  });

  it("is nothing for an empty month", () => {
    expect(topOfStack({ month: "2026-05", Ride: 0, Run: 0, Swim: 0 }, series)).toBeUndefined();
  });
});
