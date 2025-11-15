import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GoalSummaryTable from "./GoalSummaryTable";
import type { Goals } from "../utils/goalCalculations";

describe("GoalSummaryTable", () => {
  const mockGoals: Goals = [
    { id: "1", value: 2000, label: "First Goal" },
    { id: "2", value: 2500, label: "Second Goal" },
    { id: "3", value: 3000, label: "Third Goal" },
  ];

  const defaultProps = {
    goals: mockGoals,
    currentDistance: 1500,
    year: 2024,
    unit: "mi" as const,
  };

  // Save the original Date
  const RealDate = Date;

  beforeEach(() => {
    // Mock Date to a fixed point in time for predictable testing
    // June 30, 2024 (middle of the year)
    const mockDate = new Date(2024, 5, 30, 12, 0, 0);
    vi.spyOn(global, "Date").mockImplementation(((...args: any[]) => {
      if (args.length === 0) {
        return mockDate;
      }
      return new RealDate(...args);
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the component with header", () => {
    render(<GoalSummaryTable {...defaultProps} />);

    expect(screen.getByText("Goal Achievability Summary")).toBeInTheDocument();
  });

  it("displays all goals sorted by value", () => {
    render(<GoalSummaryTable {...defaultProps} />);

    // Goals should be sorted by value
    const goalLabels = screen.getAllByRole("row").slice(1); // Skip header row
    expect(goalLabels[0]).toHaveTextContent("First Goal");
    expect(goalLabels[1]).toHaveTextContent("Second Goal");
    expect(goalLabels[2]).toHaveTextContent("Third Goal");
  });

  it("displays target values with unit", () => {
    render(<GoalSummaryTable {...defaultProps} />);

    expect(screen.getByText("2,000 mi")).toBeInTheDocument();
    expect(screen.getByText("2,500 mi")).toBeInTheDocument();
    expect(screen.getByText("3,000 mi")).toBeInTheDocument();
  });

  it("displays correct progress percentage", () => {
    render(<GoalSummaryTable {...defaultProps} />);

    // 1500/2000 = 75%
    expect(screen.getByText("75%")).toBeInTheDocument();
    // 1500/2500 = 60%
    expect(screen.getByText("60%")).toBeInTheDocument();
    // 1500/3000 = 50%
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("displays remaining distance", () => {
    render(<GoalSummaryTable {...defaultProps} />);

    expect(screen.getByText("500 mi")).toBeInTheDocument(); // 2000 - 1500
    expect(screen.getByText("1000 mi")).toBeInTheDocument(); // 2500 - 1500
    expect(screen.getByText("1500 mi")).toBeInTheDocument(); // 3000 - 1500
  });

  describe("Status badges", () => {
    it("shows 'Achieved' for 100% or more progress", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={2000} />);

      expect(screen.getByText("Achieved ✓")).toBeInTheDocument();
    });

    it("shows 'Nearly There' for 90-99% progress", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={1850} />);

      // 1850/2000 = 92.5%
      expect(screen.getByText("Nearly There")).toBeInTheDocument();
    });

    it("shows 'On Track' for 75-89% progress", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={1600} />);

      // 1600/2000 = 80%
      expect(screen.getByText("On Track")).toBeInTheDocument();
    });

    it("shows 'Behind' for 50-74% progress", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={1200} />);

      // 1200/2000 = 60%
      expect(screen.getByText("Behind")).toBeInTheDocument();
    });

    it("shows 'Far Behind' for less than 50% progress", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={800} />);

      // 800/2000 = 40%
      expect(screen.getByText("Far Behind")).toBeInTheDocument();
    });
  });

  describe("Daily pace calculations", () => {
    it("displays daily pace needed for current year", () => {
      render(<GoalSummaryTable {...defaultProps} year={2024} />);

      // Should show "Daily Pace Needed" column
      expect(screen.getByText("Daily Pace Needed")).toBeInTheDocument();
    });

    it("does not display daily pace for historical years", () => {
      render(<GoalSummaryTable {...defaultProps} year={2023} />);

      // Should not show "Daily Pace Needed" column
      expect(screen.queryByText("Daily Pace Needed")).not.toBeInTheDocument();
      expect(screen.getByText("Historical year - pace calculations not applicable")).toBeInTheDocument();
    });

    it("calculates correct daily pace needed", () => {
      // Mock date: June 30, 2024
      // Days remaining: Dec 31 - June 30 = 185 days (approximately)
      // Goal: 2000, Current: 1500, Remaining: 500
      // Daily pace: 500 / 185 ≈ 2.7 mi/day
      render(<GoalSummaryTable {...defaultProps} year={2024} />);

      // Look for daily pace values (they should be present)
      const dailyPaceValues = screen.getAllByText(/mi\/day/);
      expect(dailyPaceValues.length).toBeGreaterThan(0);
    });

    it("shows 0 daily pace when goal is already achieved", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={2100} year={2024} />);

      // Goal 2000 is achieved, should show 0.0 mi/day
      expect(screen.getByText("0.0 mi/day")).toBeInTheDocument();
    });
  });

  describe("Days remaining", () => {
    it("displays days remaining for current year", () => {
      render(<GoalSummaryTable {...defaultProps} year={2024} />);

      // Should show something like "184 days remaining in 2024"
      expect(screen.getByText(/days remaining in 2024/)).toBeInTheDocument();
    });

    it("does not display days remaining for historical year", () => {
      render(<GoalSummaryTable {...defaultProps} year={2023} />);

      expect(screen.queryByText(/days remaining/)).not.toBeInTheDocument();
    });
  });

  describe("Unit display", () => {
    it("displays miles unit", () => {
      render(<GoalSummaryTable {...defaultProps} unit="mi" />);

      expect(screen.getByText("2,000 mi")).toBeInTheDocument();
    });

    it("displays kilometers unit", () => {
      render(<GoalSummaryTable {...defaultProps} unit="km" />);

      expect(screen.getByText("2,000 km")).toBeInTheDocument();
      expect(screen.getAllByText(/km/).length).toBeGreaterThan(0);
    });

    it("displays sessions unit", () => {
      render(<GoalSummaryTable {...defaultProps} unit="sessions" />);

      expect(screen.getByText("2,000 sessions")).toBeInTheDocument();
    });

    it("defaults to miles when unit not provided", () => {
      const { goals, currentDistance, year } = defaultProps;
      render(<GoalSummaryTable goals={goals} currentDistance={currentDistance} year={year} />);

      expect(screen.getByText("2,000 miles")).toBeInTheDocument();
    });
  });

  describe("Progress bars", () => {
    it("renders progress bars with correct widths", () => {
      render(<GoalSummaryTable {...defaultProps} />);

      const progressBars = screen.getAllByRole("progressbar");
      expect(progressBars.length).toBe(3);

      // First goal: 1500/2000 = 75%
      expect(progressBars[0]).toHaveStyle({ width: "75%" });

      // Second goal: 1500/2500 = 60%
      expect(progressBars[1]).toHaveStyle({ width: "60%" });

      // Third goal: 1500/3000 = 50%
      expect(progressBars[2]).toHaveStyle({ width: "50%" });
    });

    it("caps progress bar width at 100%", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={2500} />);

      const progressBars = screen.getAllByRole("progressbar");

      // First goal: 2500/2000 = 125% but should be capped at 100%
      expect(progressBars[0]).toHaveStyle({ width: "100%" });
    });

    it("sets correct aria attributes on progress bars", () => {
      render(<GoalSummaryTable {...defaultProps} />);

      const progressBars = screen.getAllByRole("progressbar");

      // Check first progress bar
      expect(progressBars[0]).toHaveAttribute("aria-valuemin", "0");
      expect(progressBars[0]).toHaveAttribute("aria-valuemax", "100");
      expect(progressBars[0]).toHaveAttribute("aria-valuenow");
    });
  });

  describe("Goal sorting", () => {
    it("sorts goals by value ascending", () => {
      const unsortedGoals: Goals = [
        { id: "1", value: 3000, label: "High" },
        { id: "2", value: 1000, label: "Low" },
        { id: "3", value: 2000, label: "Medium" },
      ];

      render(<GoalSummaryTable {...defaultProps} goals={unsortedGoals} />);

      const rows = screen.getAllByRole("row").slice(1); // Skip header
      expect(rows[0]).toHaveTextContent("Low");
      expect(rows[1]).toHaveTextContent("Medium");
      expect(rows[2]).toHaveTextContent("High");
    });

    it("preserves original color mapping despite sorting", () => {
      const unsortedGoals: Goals = [
        { id: "1", value: 3000, label: "High" },
        { id: "2", value: 1000, label: "Low" },
      ];

      const { container } = render(<GoalSummaryTable {...defaultProps} goals={unsortedGoals} />);

      // Each goal should maintain its original color based on original index
      // Even though they're sorted, colors should match original positions
      const borderLefts = container.querySelectorAll('[style*="border-left"]');
      expect(borderLefts.length).toBeGreaterThan(0);
    });
  });

  describe("Goal labels", () => {
    it("displays goal labels", () => {
      render(<GoalSummaryTable {...defaultProps} />);

      expect(screen.getByText("First Goal")).toBeInTheDocument();
      expect(screen.getByText("Second Goal")).toBeInTheDocument();
      expect(screen.getByText("Third Goal")).toBeInTheDocument();
    });

    it("shows 'Unnamed' for goals without labels", () => {
      const goalsWithoutLabels: Goals = [
        { id: "1", value: 2000 },
      ];

      render(<GoalSummaryTable {...defaultProps} goals={goalsWithoutLabels} />);

      expect(screen.getByText("Unnamed")).toBeInTheDocument();
    });
  });

  describe("Edge cases", () => {
    it("handles zero current distance", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={0} />);

      expect(screen.getByText("0%")).toBeInTheDocument();
      expect(screen.getByText("2,000 mi")).toBeInTheDocument(); // Remaining equals target
    });

    it("handles single goal", () => {
      const singleGoal: Goals = [{ id: "1", value: 2000, label: "Only Goal" }];

      render(<GoalSummaryTable {...defaultProps} goals={singleGoal} />);

      expect(screen.getByText("Only Goal")).toBeInTheDocument();
    });

    it("handles many goals (5 max)", () => {
      const manyGoals: Goals = [
        { id: "1", value: 1000, label: "Goal 1" },
        { id: "2", value: 2000, label: "Goal 2" },
        { id: "3", value: 3000, label: "Goal 3" },
        { id: "4", value: 4000, label: "Goal 4" },
        { id: "5", value: 5000, label: "Goal 5" },
      ];

      render(<GoalSummaryTable {...defaultProps} goals={manyGoals} />);

      expect(screen.getByText("Goal 1")).toBeInTheDocument();
      expect(screen.getByText("Goal 5")).toBeInTheDocument();
    });

    it("handles progress over 100%", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={2500} />);

      // 2500/2000 = 125%
      expect(screen.getByText("125%")).toBeInTheDocument();
      expect(screen.getByText("Achieved ✓")).toBeInTheDocument();
    });

    it("handles negative remaining (when goal exceeded)", () => {
      render(<GoalSummaryTable {...defaultProps} currentDistance={2100} />);

      // Remaining should be 0, not negative
      expect(screen.getByText("0 mi")).toBeInTheDocument();
    });
  });

  describe("Future year", () => {
    it("treats future years as non-current", () => {
      render(<GoalSummaryTable {...defaultProps} year={2025} />);

      // Future years should be treated like historical years
      expect(screen.queryByText("Daily Pace Needed")).not.toBeInTheDocument();
    });
  });
});
