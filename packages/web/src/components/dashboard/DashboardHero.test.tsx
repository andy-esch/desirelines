import { describe, it, expect } from "vitest";
import { countGoalsOnPace } from "./DashboardHero";

// Halfway through the year: linear pacing puts a 1,000 mi goal at 500 mi today.
const HALFWAY = 0.5;

describe("countGoalsOnPace", () => {
  it("counts achieved goals and goals at the on-track share of today's pace", () => {
    expect(
      countGoalsOnPace(
        [
          { currentValue: 1200, targetGoal: 1000 }, // achieved
          { currentValue: 460, targetGoal: 1000 }, // 92% of pace
          { currentValue: 440, targetGoal: 1000 }, // 88% of pace
        ],
        HALFWAY
      )
    ).toEqual({ onPace: 2, total: 3 });
  });

  it("leaves sports without a target out of the total", () => {
    expect(
      countGoalsOnPace(
        [
          { currentValue: 10, targetGoal: 0 },
          { currentValue: 600, targetGoal: 1000 },
        ],
        HALFWAY
      )
    ).toEqual({ onPace: 1, total: 1 });
  });

  it("counts any progress as on pace before pacing expects any", () => {
    expect(countGoalsOnPace([{ currentValue: 1, targetGoal: 1000 }], 0)).toEqual({
      onPace: 1,
      total: 1,
    });
  });
});
