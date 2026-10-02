import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardHero, { countGoalsOnPace } from "./DashboardHero";
import { createYearContext } from "../../utils/yearContext";
import type { SportGoalData } from "../../hooks/useDashboardGoalData";

vi.mock("../../hooks/useDashboardGoalData", () => ({ useDashboardGoalData: vi.fn() }));
vi.mock("../../hooks/useWeeklySummary", () => ({
  useWeeklySummary: () => ({ sportTotals: [], weekLabel: "", isLoading: false, error: null }),
}));
vi.mock("../../hooks/useTrailingYearActivityCount", () => ({
  useTrailingYearActivityCount: () => ({ count: 120, isLoading: false }),
}));

import { useDashboardGoalData } from "../../hooks/useDashboardGoalData";

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

describe("DashboardHero goals on pace", () => {
  const sport = (sportId: string, hasGoal: boolean): SportGoalData => ({
    sport: sportId,
    displayName: sportId,
    color: "#000",
    // Past its whole target, so on pace on any day of the year.
    currentValue: 1200,
    hasGoal,
    targetGoal: hasGoal ? 1000 : 0,
    metricUnit: "mi",
    metricType: "distance",
    impactGoal: hasGoal ? 1000 : 0,
    impactGoalLabel: "",
  });

  function renderHero(sportData: SportGoalData[]) {
    vi.mocked(useDashboardGoalData).mockReturnValue({
      sportData,
      yearContext: createYearContext(new Date().getFullYear()),
      distanceUnit: "miles",
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });
    render(<DashboardHero />);
    return screen.getByText("Goals on pace").nextElementSibling as HTMLElement;
  }

  it("counts only the sports with a goal", () => {
    expect(renderHero([sport("cycling", true), sport("running", false)])).toHaveTextContent("1/1");
  });

  it("shows the missing value, not 0/0, when no sport has a goal", () => {
    const value = renderHero([sport("cycling", false), sport("running", false)]);
    expect(value).toHaveTextContent("none");
    expect(value).not.toHaveTextContent("/");
  });
});
