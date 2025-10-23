import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import KPICards from "./KPICards";

describe("KPICards", () => {
  const defaultProps = {
    currentDistance: 2450,
    averagePace: 8.3,
    daysElapsed: 295,
    daysRemaining: 70,
    nextGoal: { label: "Challenger", value: 3000 },
    nextGoalProgress: 81.7,
    nextGoalGap: 550,
    paceNeededForNextGoal: 7.9,
  };

  it("renders all three KPI cards", () => {
    render(<KPICards {...defaultProps} />);

    expect(screen.getByText("Current Distance")).toBeInTheDocument();
    expect(screen.getByText("Challenger")).toBeInTheDocument();
    expect(screen.getByText("Pace to Challenger")).toBeInTheDocument();
  });

  it("displays current distance with average pace", () => {
    render(<KPICards {...defaultProps} />);

    expect(screen.getByText("2450 mi")).toBeInTheDocument();
    expect(screen.getByText(/8.3 mi\/day avg/)).toBeInTheDocument();
    expect(screen.getByText(/295 days/)).toBeInTheDocument();
  });

  it("displays next goal progress percentage", () => {
    render(<KPICards {...defaultProps} />);

    expect(screen.getByText("82%")).toBeInTheDocument(); // 81.7 rounds to 82
    expect(screen.getByText(/550 mi to 3,000/)).toBeInTheDocument();
  });

  it("displays pace needed to reach goal", () => {
    render(<KPICards {...defaultProps} />);

    expect(screen.getByText("7.9")).toBeInTheDocument();
    expect(screen.getByText(/mi\/day · 70 days left/)).toBeInTheDocument();
  });

  it("renders momentum indicator when provided", () => {
    render(
      <KPICards {...defaultProps} momentumIndicator={<span data-testid="momentum">↑</span>} />
    );

    expect(screen.getByTestId("momentum")).toBeInTheDocument();
  });

  it("handles no goal gracefully", () => {
    render(
      <KPICards
        {...defaultProps}
        nextGoal={null}
        nextGoalProgress={0}
        nextGoalGap={0}
        paceNeededForNextGoal={0}
      />
    );

    expect(screen.getByText("Next Goal")).toBeInTheDocument();
    expect(screen.getByText("No goal set")).toBeInTheDocument();
    expect(screen.getByText("Pace to Goal")).toBeInTheDocument();
  });

  it("displays goal reached message when gap is zero", () => {
    render(
      <KPICards
        {...defaultProps}
        nextGoalGap={0}
        nextGoalProgress={100}
        paceNeededForNextGoal={0}
      />
    );

    expect(screen.getByText("3,000 mi reached!")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // No pace needed
    expect(screen.getByText(/70 days remaining/)).toBeInTheDocument();
  });

  it("handles missing momentum indicator", () => {
    render(<KPICards {...defaultProps} />);

    // Should render without indicator
    expect(screen.getByText("Current Distance")).toBeInTheDocument();
    expect(screen.getByText(/8.3 mi\/day avg/)).toBeInTheDocument();
  });
});
