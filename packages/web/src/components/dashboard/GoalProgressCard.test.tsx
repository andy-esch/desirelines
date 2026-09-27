import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import GoalProgressCard, { getStatusForDashboard } from "./GoalProgressCard";
import { renderWithRouter } from "../../test/renderWithRouter";
import { ThemeStructureProvider } from "../theme/ThemeStructureProvider";
import { getTheme, type ThemeId } from "../../themes/registry";
import type { SportGoalData } from "../../hooks/useDashboardGoalData";
import type { YearContext } from "../../utils/yearContext";

vi.mock("../../hooks/useDashboardGoalData", () => ({ useDashboardGoalData: vi.fn() }));

import { useDashboardGoalData } from "../../hooks/useDashboardGoalData";
const mockGoalData = vi.mocked(useDashboardGoalData);

// 146 of 2026's 365 days: linear pacing puts a 1,000 mi goal at 400 mi today.
const YEAR: YearContext = {
  year: 2026,
  isCurrentYear: true,
  isPastYear: false,
  isFutureYear: false,
  daysElapsed: 146,
  daysRemaining: 220,
  shouldShowPacing: true,
  shouldShowProgress: true,
};
const PAST_YEAR: YearContext = {
  ...YEAR,
  year: 2025,
  isCurrentYear: false,
  isPastYear: true,
  daysElapsed: 365,
  daysRemaining: 0,
  shouldShowPacing: false,
};
const NOT_BEGUN: YearContext = { ...YEAR, daysElapsed: 0, daysRemaining: 365 };

function cycling(currentValue: number, overrides: Partial<SportGoalData> = {}): SportGoalData {
  return {
    sport: "cycling",
    displayName: "Cycling",
    color: "#00f0ff",
    currentValue,
    hasGoal: true,
    targetGoal: 1000,
    metricUnit: "mi",
    metricType: "distance",
    impactGoal: 800,
    impactGoalLabel: "Conservative",
    ...overrides,
  };
}

function returnGoalData(
  sportData: SportGoalData[],
  { yearContext = YEAR, isLoading = false, error = null as Error | null } = {}
) {
  mockGoalData.mockReturnValue({
    sportData,
    yearContext,
    distanceUnit: "miles",
    isLoading,
    error,
  });
}

function renderCard(theme: ThemeId = "miami") {
  return renderWithRouter(<GoalProgressCard />, {
    wrapper: ({ children }) => (
      <ThemeStructureProvider structure={getTheme(theme).structure}>
        {children}
      </ThemeStructureProvider>
    ),
  });
}

describe("getStatusForDashboard", () => {
  it.each([
    ["an achieved goal", 1000, YEAR, { label: "Achieved", delta: null }],
    ["ahead, at 120% of today's pace", 480, YEAR, { label: "Ahead", delta: 80 }],
    ["on track, at today's pace", 400, YEAR, { label: "On Track", delta: 0 }],
    ["on track, at 90% of today's pace", 360, YEAR, { label: "On Track", delta: -40 }],
    [
      "slightly behind, at 80% of today's pace",
      320,
      YEAR,
      { label: "Slightly Behind", delta: -80 },
    ],
    ["behind, at 50% of today's pace", 200, YEAR, { label: "Behind", delta: -200 }],
    ["a past year's achieved goal", 1000, PAST_YEAR, { label: "Achieved", delta: null }],
    ["a past year's missed goal", 999, PAST_YEAR, { label: "Not Met", delta: null }],
    ["progress before the year has begun", 5, NOT_BEGUN, { label: "Ahead", delta: null }],
    ["nothing before the year has begun", 0, NOT_BEGUN, { label: null, delta: null }],
  ] as const)("reads %s", (_, current, yearContext, expected) => {
    const status = getStatusForDashboard(current, 1000, yearContext);
    expect(status.label).toBe(expected.label);
    if (expected.delta === null) expect(status.delta).toBeNull();
    else expect(status.delta).toBeCloseTo(expected.delta, 6);
  });

  it("judges nothing logged on the year's first day as behind, since that day counts", () => {
    const dayOne = { ...YEAR, daysElapsed: 1, daysRemaining: 365 };
    expect(getStatusForDashboard(0, 1000, dayOne).label).toBe("Behind");
  });
});

describe("GoalProgressCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["ahead", 480, "80.0 mi ahead"],
    ["behind", 200, "200 mi behind"],
    ["slightly behind", 320, "80.0 mi behind"],
  ])("phrases a goal %s by its distance from today's pace", async (_, current, phrase) => {
    returnGoalData([cycling(current)]);
    await renderCard();
    expect(screen.getByText(phrase)).toBeInTheDocument();
  });

  it("names the status without a distance when on track or achieved", async () => {
    returnGoalData([cycling(400), cycling(1200, { sport: "running", displayName: "Running" })]);
    await renderCard();
    expect(screen.getByText("On Track")).toBeInTheDocument();
    expect(screen.getByText("Achieved")).toBeInTheDocument();
  });

  it("phrases a time goal's distance from pace in hours and minutes", async () => {
    returnGoalData([
      cycling(35, {
        sport: "yoga",
        displayName: "Yoga",
        targetGoal: 100,
        metricUnit: "hrs",
        metricType: "time",
      }),
    ]);
    await renderCard();
    // 40% of 100 hours is 40 today; 35 is 5 hours short.
    expect(screen.getByText("5 hr behind")).toBeInTheDocument();
  });

  it("shows the missing-value mark when there's no pace to judge yet", async () => {
    returnGoalData([cycling(0)], { yearContext: NOT_BEGUN });
    await renderCard();
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("shows the current value against the target", async () => {
    returnGoalData([cycling(400)]);
    await renderCard();
    expect(screen.getByText("400 mi / 1,000 mi")).toBeInTheDocument();
  });

  it("draws a goal track in themes without the percent bar", async () => {
    returnGoalData([cycling(400)]);
    await renderCard("miami");
    expect(screen.getByRole("progressbar", { name: "Cycling goal progress" })).toHaveAttribute(
      "aria-valuenow",
      "40"
    );
    expect(screen.queryByText("🐲")).not.toBeInTheDocument();
    expect(screen.getByText("Pace today")).toBeInTheDocument();
  });

  it("draws the race track in themes with the percent bar", async () => {
    returnGoalData([cycling(400)]);
    await renderCard("legacy-light");
    expect(screen.queryByRole("progressbar", { name: "Cycling goal progress" })).toBeNull();
    expect(screen.getAllByText("🐲").length).toBeGreaterThan(0);
  });

  it("links each sport to its page for the year", async () => {
    returnGoalData([cycling(400)]);
    await renderCard();
    expect(screen.getByRole("link", { name: "Cycling" })).toHaveAttribute("href", "/cycling/2026");
  });

  it("shows the day of the year while pacing applies", async () => {
    returnGoalData([cycling(400)]);
    await renderCard();
    expect(screen.getByText("Day 146 of 365")).toBeInTheDocument();
  });

  it("says so when no sports are configured", async () => {
    returnGoalData([]);
    await renderCard();
    expect(screen.getByText("No sports configured")).toBeInTheDocument();
  });

  it("shows skeletons while loading and a message on error", async () => {
    returnGoalData([], { isLoading: true });
    const { unmount } = await renderCard();
    expect(screen.getByRole("status", { name: "Loading goal progress" })).toBeInTheDocument();
    unmount();

    returnGoalData([], { error: new Error("boom") });
    await renderCard();
    expect(screen.getByText("Unable to load goal progress")).toBeInTheDocument();
  });

  describe("a sport without a goal", () => {
    const running = cycling(1204, {
      sport: "running",
      displayName: "Running",
      hasGoal: false,
      targetGoal: 0,
      impactGoal: 0,
      impactGoalLabel: "",
    });

    it.each(["miami", "legacy-light"] as const)(
      "says No goal and links to where one is set, in %s",
      async (theme) => {
        returnGoalData([cycling(400), running]);
        await renderCard(theme);

        expect(screen.getByText("No goal")).toBeInTheDocument();
        expect(screen.getByText(/1,204 mi/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Set a goal for Running" })).toHaveAttribute(
          "href",
          "/running/2026"
        );
      }
    );

    it("draws no track, status or target for it", async () => {
      returnGoalData([cycling(400), running]);
      await renderCard("miami");

      // The row is the sport, "No goal", and the year's total with the link: nothing else.
      const row = screen.getByText("No goal").closest<HTMLElement>("div.flex-col")!;
      expect(row).toHaveTextContent(/^RunningNo goal1,204 mi · Set a goal$/);
      expect(within(row).queryByRole("progressbar")).toBeNull();
      // Cycling, which has a goal, keeps its track and status.
      expect(
        screen.getByRole("progressbar", { name: "Cycling goal progress" })
      ).toBeInTheDocument();
      expect(screen.getByText("On Track")).toBeInTheDocument();
    });

    it("leaves the track legend out when no sport has a goal", async () => {
      returnGoalData([running]);
      await renderCard("miami");
      expect(screen.queryByText("Pace today")).toBeNull();
      expect(screen.queryByText("You")).toBeNull();
    });

    it("keeps the legend while another sport has a goal", async () => {
      returnGoalData([cycling(400), running]);
      await renderCard("miami");
      expect(screen.getByText("Pace today")).toBeInTheDocument();
    });
  });
});
