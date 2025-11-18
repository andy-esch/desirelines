import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import KPICards from "./KPICards";
import { createYearContext } from "../../utils/yearContext";

// Mock the date for consistent testing
// October 23, 2025 = 295 days elapsed, 70 days remaining (UTC calculation)
const mockCurrentDate = new Date("2025-10-23T00:00:00.000Z");

describe("KPICards", () => {
  let testYearContext: ReturnType<typeof createYearContext>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(mockCurrentDate);
    // Create yearContext AFTER setting system time to ensure consistency
    testYearContext = createYearContext(2025);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const getDefaultProps = () => ({
    currentDistance: 2450,
    averagePace: 8.3,
    yearContext: testYearContext, // Use the pre-created context
    nextGoal: { label: "Challenger", value: 3000 },
    nextGoalProgress: 81.7,
    nextGoalGap: 550,
    paceNeededForNextGoal: 7.9,
  });

  it("renders all three KPI cards", () => {
    render(<KPICards {...getDefaultProps()} />);

    expect(screen.getByText("Current Distance")).toBeInTheDocument();
    expect(screen.getByText("Challenger")).toBeInTheDocument();
    expect(screen.getByText("Pace to Challenger")).toBeInTheDocument();
  });

  it("displays current distance with average pace", () => {
    render(<KPICards {...getDefaultProps()} />);

    expect(screen.getByText("2450 miles")).toBeInTheDocument();
    expect(screen.getByText(/8.3 miles \/ day avg/)).toBeInTheDocument();
    expect(screen.getByText(/295 days elapsed/)).toBeInTheDocument();
  });

  it("displays next goal progress percentage", () => {
    render(<KPICards {...getDefaultProps()} />);

    expect(screen.getByText("82%")).toBeInTheDocument(); // 81.7 rounds to 82
    expect(screen.getByText(/550 miles to 3,000/)).toBeInTheDocument();
  });

  it("displays pace needed to reach goal", () => {
    render(<KPICards {...getDefaultProps()} />);

    expect(screen.getByText("7.9")).toBeInTheDocument();
    expect(screen.getByText(/miles \/ day · 70 days left/)).toBeInTheDocument();
  });

  it("renders momentum indicator when provided", () => {
    render(
      <KPICards {...getDefaultProps()} momentumIndicator={<span data-testid="momentum">↑</span>} />
    );

    expect(screen.getByTestId("momentum")).toBeInTheDocument();
  });

  it("handles no goal gracefully", () => {
    render(
      <KPICards
        {...getDefaultProps()}
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
        {...getDefaultProps()}
        nextGoalGap={0}
        nextGoalProgress={100}
        paceNeededForNextGoal={0}
      />
    );

    expect(screen.getByText("3,000 miles reached!")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument(); // No pace needed
    expect(screen.getByText(/70 days remaining/)).toBeInTheDocument();
  });

  it("handles missing momentum indicator", () => {
    render(<KPICards {...getDefaultProps()} />);

    // Should render without indicator
    expect(screen.getByText("Current Distance")).toBeInTheDocument();
    expect(screen.getByText(/8.3 miles \/ day avg/)).toBeInTheDocument();
  });
});
