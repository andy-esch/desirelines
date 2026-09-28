import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import WeeklySummaryCard from "./WeeklySummaryCard";
import { ThemeStructureProvider } from "../theme/ThemeStructureProvider";
import { getTheme, type ThemeId } from "../../themes/registry";
import type { WeeklySportTotal } from "../../hooks/useWeeklySummary";

vi.mock("../../hooks/useWeeklySummary", () => ({ useWeeklySummary: vi.fn() }));

import { useWeeklySummary } from "../../hooks/useWeeklySummary";
const mockWeeklySummary = vi.mocked(useWeeklySummary);

function total(
  sport: string,
  weeklyTotal: number,
  overrides: Partial<WeeklySportTotal> = {}
): WeeklySportTotal {
  return {
    sport,
    displayName: sport[0]!.toUpperCase() + sport.slice(1),
    color: "#00f0ff",
    weeklyTotal,
    hasGoal: true,
    weeklyGoal: 50,
    achievementPct: (weeklyTotal / 50) * 100,
    metricUnit: "mi",
    metricType: "distance",
    ...overrides,
  };
}

function returnSummary(
  sportTotals: WeeklySportTotal[],
  { isLoading = false, error = null as Error | null } = {}
) {
  mockWeeklySummary.mockReturnValue({
    sportTotals,
    weekLabel: "Sep 21 – Sep 27",
    isLoading,
    error,
  });
}

function renderCard(theme: ThemeId = "miami") {
  return render(
    <ThemeStructureProvider structure={getTheme(theme).structure}>
      <WeeklySummaryCard />
    </ThemeStructureProvider>
  );
}

/** The row for a sport, found by its name. */
const row = (name: string) =>
  screen.getByText(name).closest<HTMLElement>("div.flex.items-center.justify-between")!;

describe("WeeklySummaryCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows each sport's total and sums them by kind in the footer", () => {
    returnSummary([
      total("cycling", 84.2),
      total("running", 22),
      total("yoga", 1.5, { metricType: "time", metricUnit: "hrs" }),
      total("climbing", 3, { metricType: "sessions", metricUnit: "sessions" }),
    ]);
    renderCard();

    expect(within(row("Cycling")).getByText("84.2 mi")).toBeInTheDocument();
    expect(within(row("Yoga")).getByText("1 hr 30 min")).toBeInTheDocument();
    expect(within(row("Climbing")).getByText("3 sessions")).toBeInTheDocument();
    expect(screen.getByText("106 mi")).toBeInTheDocument();
    expect(screen.getByText("Sep 21 – Sep 27")).toBeInTheDocument();
  });

  // Each band's edges: 100%, 75% and 50% of the week's share of the goal.
  it.each([
    [50, "ahead"],
    [49, "on-track"],
    [37.5, "on-track"],
    [37, "slightly-behind"],
    [25, "slightly-behind"],
    [24, "behind"],
  ])("marks %s mi of a 50 mi week as %s", (miles, status) => {
    returnSummary([total("cycling", miles)]);
    renderCard();

    const symbol = within(row("Cycling")).getByText(`${(miles / 50) * 100}% of goal`);
    expect(symbol.closest("[data-status]")).toHaveAttribute("data-status", status);
  });

  describe("a sport with nothing this week", () => {
    it.each(["miami", "arcade"] as const)(
      "shows the missing-value mark and the no-activity symbol in %s",
      (theme) => {
        returnSummary([total("cycling", 20), total("running", 0)]);
        renderCard(theme);

        const running = within(row("Running"));
        expect(running.getByText("none")).toBeInTheDocument();
        expect(running.getByText("No activity")).toBeInTheDocument();
        expect(running.queryByText(/of goal/)).toBeNull();
      }
    );
  });

  it.each(["miami", "arcade"] as const)(
    "shows a sport without a goal its total and no share of a goal, in %s",
    (theme) => {
      returnSummary([
        total("cycling", 20),
        total("running", 22, { hasGoal: false, weeklyGoal: 0, achievementPct: 0 }),
      ]);
      renderCard(theme);

      const running = within(row("Running"));
      expect(running.getByText("22.0 mi")).toBeInTheDocument();
      expect(running.queryByText(/%/)).toBeNull();
      expect(row("Running").querySelector("[data-status]")).toBeNull();
      // Cycling, which has a goal, keeps its share.
      expect(within(row("Cycling")).getByText(/40%/)).toBeInTheDocument();
    }
  );

  it("says so when no sport has anything this week", () => {
    returnSummary([total("cycling", 0), total("running", 0)]);
    renderCard();
    expect(screen.getByText("No activity yet this week")).toBeInTheDocument();
    expect(screen.queryByText("Cycling")).toBeNull();
  });

  it("shows skeletons while loading and a message on error", () => {
    returnSummary([], { isLoading: true });
    const { unmount } = renderCard();
    expect(screen.getByRole("status", { name: "Loading weekly summary" })).toBeInTheDocument();
    unmount();

    returnSummary([], { error: new Error("boom") });
    renderCard();
    expect(screen.getByText("Unable to load weekly summary")).toBeInTheDocument();
  });
});
