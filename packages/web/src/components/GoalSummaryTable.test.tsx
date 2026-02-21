import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GoalSummaryTable from "./GoalSummaryTable";
import type { Goals } from "../utils/goalCalculations";
import { createYearContext } from "../utils/yearContext";

// Mock the date for consistent testing (local time)
// June 15, 2025 = 166 days elapsed, 200 days remaining
const mockCurrentDate = new Date(2025, 5, 15, 12, 0, 0); // Mid-year (June 15 local noon)

describe("GoalSummaryTable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockCurrentDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseGoals: Goals = [
    { id: "1", value: 1000, label: "Conservative" },
    { id: "2", value: 2000, label: "Target" },
    { id: "3", value: 3000, label: "Stretch" },
  ];

  describe("Rendering", () => {
    it("renders table with all goals", () => {
      const { container } = render(
        <GoalSummaryTable
          goals={baseGoals}
          currentDistance={1500}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      const tbody = container.querySelector("tbody");
      expect(tbody).toHaveTextContent("Conservative");
      expect(tbody).toHaveTextContent("Target");
      expect(tbody).toHaveTextContent("Stretch");
    });

    it("displays correct target values with units", () => {
      const { container } = render(
        <GoalSummaryTable
          goals={baseGoals}
          currentDistance={1500}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      const tbody = container.querySelector("tbody");
      expect(tbody).toHaveTextContent("1,000 miles");
      expect(tbody).toHaveTextContent("2,000 miles");
      expect(tbody).toHaveTextContent("3,000 miles");
    });

    it("uses provided unit label", () => {
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 100, label: "Yoga Goal" }]}
          currentDistance={50}
          yearContext={createYearContext(2025)}
          unit="sessions"
          sport="yoga"
        />
      );

      const tbody = container.querySelector("tbody");
      expect(tbody).toHaveTextContent("100 sessions");
    });

    it("sorts goals by value", () => {
      const unsortedGoals: Goals = [
        { id: "1", value: 3000, label: "Third" },
        { id: "2", value: 1000, label: "First" },
        { id: "3", value: 2000, label: "Second" },
      ];

      const { container } = render(
        <GoalSummaryTable
          goals={unsortedGoals}
          currentDistance={1500}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      const rows = container.querySelectorAll("tbody tr");
      expect(rows[0]).toHaveTextContent("First");
      expect(rows[1]).toHaveTextContent("Second");
      expect(rows[2]).toHaveTextContent("Third");
    });
  });

  describe("Progress Calculation", () => {
    it("calculates progress percentage correctly", () => {
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 2000, label: "Test Goal" }]}
          currentDistance={1000}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      // 1000/2000 = 50%
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("caps progress at 100%", () => {
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={1500}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      // Progress should show 150% but be capped visually
      const progressBar = screen.getByRole("progressbar");
      expect(progressBar).toHaveStyle({ width: "100%" });
    });

    it("calculates remaining distance correctly", () => {
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 2000, label: "Test Goal" }]}
          currentDistance={1500}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      const tbody = container.querySelector("tbody");
      expect(tbody).toHaveTextContent("500 miles");
    });

    it("shows 0 remaining when goal is exceeded", () => {
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={1500}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      // Check for "0 miles" in remaining column (4th td)
      const rows = container.querySelectorAll("tbody tr");
      const cells = rows[0]?.querySelectorAll("td");
      expect(cells?.[4]).toHaveTextContent("0 miles");
    });
  });

  describe("Status Text (Pace-Based)", () => {
    // Mock date is June 15 = day 166 of 366 (45.4% through year)
    // For a 1000-mile goal, prorated target by June 15 is ~454 miles
    // Status is based on pace ratio (actual / prorated goal):
    //   >= 1.1: "Ahead", >= 0.9: "On Track", >= 0.75: "Slightly Behind",
    //   >= 0.5: "Behind", < 0.5: "Far Behind"

    it('shows "Achieved" with check icon for completed goals', () => {
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={1000}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.getByText("Achieved")).toBeInTheDocument();
    });

    it('shows "Ahead" when >10% ahead of pace', () => {
      // Prorated goal: 1000 * (166/366) = 454 miles
      // Need 454 * 1.1 = 500+ miles for "Ahead"
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={550}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.getByText("Ahead")).toBeInTheDocument();
    });

    it('shows "On Track" when within 10% of pace', () => {
      // Prorated goal: ~454 miles
      // Pace ratio 0.9-1.1 = 409-499 miles
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={450}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.getByText("On Track")).toBeInTheDocument();
    });

    it('shows "Slightly Behind" when 75-90% of pace', () => {
      // Prorated goal: ~454 miles
      // Pace ratio 0.75-0.9 = 341-408 miles
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={370}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.getByText("Slightly Behind")).toBeInTheDocument();
    });

    it('shows "Behind" when 50-75% of pace', () => {
      // Prorated goal: ~454 miles
      // Pace ratio 0.5-0.75 = 227-340 miles
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={280}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.getByText("Behind")).toBeInTheDocument();
    });

    it('shows "Far Behind" when <50% of pace', () => {
      // Prorated goal: ~454 miles
      // Pace ratio < 0.5 = less than 227 miles
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={100}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.getByText("Far Behind")).toBeInTheDocument();
    });
  });

  describe("Danger Zone Warning", () => {
    it("highlights row for dangerous pace (cycling)", () => {
      // Cycling danger threshold: 20 mi/day
      // Need 4100 miles, have 0, with 200 days remaining (mid-June to end of year)
      // Pace needed: 4100 / 200 = 20.5 mi/day (exceeds threshold)
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 4100, label: "Dangerous Goal" }]}
          currentDistance={0}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      const row = container.querySelector("tbody tr");
      expect(row).toHaveClass("table-row-danger");
    });

    it("highlights row for dangerous pace (running)", () => {
      // Running danger threshold: 10 mi/day
      // Need 2100 miles, have 0, with 200 days remaining
      // Pace needed: 2100 / 200 = 10.5 mi/day (exceeds threshold)
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 2100, label: "Dangerous Goal" }]}
          currentDistance={0}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="running"
        />
      );

      const row = container.querySelector("tbody tr");
      expect(row).toHaveClass("table-row-danger");
    });

    it("highlights row for dangerous pace (yoga)", () => {
      // Yoga danger threshold: 120 min/day
      // Need 24100 minutes, have 0, with 200 days remaining (Jun 15 to Dec 31 UTC)
      // Pace needed: 24100 / 200 = 120.5 min/day (exceeds threshold)
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 24100, label: "Dangerous Goal" }]}
          currentDistance={0}
          yearContext={createYearContext(2025)}
          unit="minutes"
          sport="yoga"
        />
      );

      const row = container.querySelector("tbody tr");
      expect(row).toHaveClass("table-row-danger");
    });

    it("does not highlight row for safe pace", () => {
      // Need 1000 miles, have 0, with 200 days remaining
      // Pace needed: 1000 / 200 = 5 mi/day (safe for cycling)
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Safe Goal" }]}
          currentDistance={0}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      const row = container.querySelector("tbody tr");
      expect(row).not.toHaveClass("table-row-danger");
    });

    it("shows warning icon for dangerous goals", () => {
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 4100, label: "Dangerous Goal" }]}
          currentDistance={0}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      // Warning icon is an SVG with sr-only text for screen readers
      expect(screen.getByText("Warning: unsustainable pace")).toBeInTheDocument();
    });

    it("shows warning banner when dangerous goals exist", () => {
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 4100, label: "Dangerous Goal" }]}
          currentDistance={0}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      // Target the alert banner specifically (not the inline sr-only text)
      const banner = screen.getByRole("alert");
      expect(banner).toHaveTextContent(/Warning:/);
      expect(banner).toHaveTextContent(/20 miles\/day/);
      expect(banner).toHaveTextContent(/may be unsustainable/);
    });

    it("does not show warning banner when all goals are safe", () => {
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Safe Goal" }]}
          currentDistance={0}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.queryByText(/Warning:/)).not.toBeInTheDocument();
    });
  });

  describe("Daily Pace Needed", () => {
    it("shows daily pace column for current year", () => {
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 2000, label: "Test Goal" }]}
          currentDistance={1000}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.getByText("Daily Pace Needed")).toBeInTheDocument();
    });

    it("hides daily pace column for past years", () => {
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 2000, label: "Test Goal" }]}
          currentDistance={1000}
          yearContext={createYearContext(2024)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.queryByText("Daily Pace Needed")).not.toBeInTheDocument();
      expect(screen.getByText(/Historical year/)).toBeInTheDocument();
    });

    it("calculates daily pace correctly", () => {
      // Need 2000 miles, have 1000, with 200 days remaining (Jun 15 to Dec 31)
      // Pace needed: 1000 / 200 = 5.0 mi/day
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 2000, label: "Test Goal" }]}
          currentDistance={1000}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      const tbody = container.querySelector("tbody");
      expect(tbody).toHaveTextContent(/5\.0 miles\/day/);
    });

    it("shows 0 pace when goal is already achieved", () => {
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={1500}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      const tbody = container.querySelector("tbody");
      expect(tbody).toHaveTextContent("0.0 miles/day");
    });
  });

  describe("Days Remaining", () => {
    it("shows correct days remaining for current year", () => {
      render(
        <GoalSummaryTable
          goals={baseGoals}
          currentDistance={1000}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      // June 15 to Dec 31 = 200 days (UTC calculation)
      expect(
        screen.getByText((_content, element) => {
          return (
            element?.tagName === "SMALL" && element?.textContent === "200 days remaining in 2025"
          );
        })
      ).toBeInTheDocument();
    });

    it("shows 0 days remaining for past years", () => {
      render(
        <GoalSummaryTable
          goals={baseGoals}
          currentDistance={1000}
          yearContext={createYearContext(2024)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.queryByText(/days remaining/)).not.toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("handles goals with no label", () => {
      render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000 }]}
          currentDistance={500}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.getByText("Unnamed")).toBeInTheDocument();
    });

    it("handles zero current distance", () => {
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 1000, label: "Test Goal" }]}
          currentDistance={0}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      expect(screen.getByText("0%")).toBeInTheDocument();
      const tbody = container.querySelector("tbody");
      expect(tbody).toHaveTextContent("1,000 miles"); // remaining
    });

    it("handles zero goal value", () => {
      const { container } = render(
        <GoalSummaryTable
          goals={[{ id: "1", value: 0, label: "Test Goal" }]}
          currentDistance={0}
          yearContext={createYearContext(2025)}
          unit="miles"
          sport="cycling"
        />
      );

      // Should not crash, renders with 0 values
      const tbody = container.querySelector("tbody");
      expect(tbody).toHaveTextContent("0 miles");
    });

    it("uses default sport when not provided", () => {
      render(
        <GoalSummaryTable
          goals={baseGoals}
          currentDistance={1000}
          yearContext={createYearContext(2025)}
          unit="miles"
        />
      );

      // Should use default (cycling = 20 mi/day threshold)
      expect(screen.queryByText(/Warning:/)).not.toBeInTheDocument();
    });
  });
});
