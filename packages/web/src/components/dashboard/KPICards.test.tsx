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

  describe("loading states", () => {
    it("shows loading placeholders when isLoading is true", () => {
      render(<KPICards {...getDefaultProps()} isLoading={true} />);

      // All values should show "--"
      expect(screen.getAllByText("--")).toHaveLength(3);
      // All subtitles should show "Loading..."
      expect(screen.getAllByText("Loading...")).toHaveLength(3);
    });
  });

  describe("no data states", () => {
    it("shows no data message for current year when currentDistance is 0", () => {
      render(<KPICards {...getDefaultProps()} currentDistance={0} />);

      expect(screen.getByText("--")).toBeInTheDocument();
      expect(screen.getByText(/295 days elapsed · No data available/)).toBeInTheDocument();
      expect(screen.getByText("No data available")).toBeInTheDocument();
    });

    it("shows year complete message for past year when currentDistance is 0", () => {
      const pastYearContext = createYearContext(2024);
      render(<KPICards {...getDefaultProps()} currentDistance={0} yearContext={pastYearContext} />);

      expect(screen.getByText(/2024 complete · No data available/)).toBeInTheDocument();
    });

    it("shows year complete status for past year with data", () => {
      const pastYearContext = createYearContext(2024);
      render(<KPICards {...getDefaultProps()} yearContext={pastYearContext} />);

      expect(screen.getByText(/2024 complete/)).toBeInTheDocument();
      expect(screen.getByText("Historical data")).toBeInTheDocument();
    });
  });

  describe("future year handling", () => {
    it("shows future year message in pace card", () => {
      const futureYearContext = createYearContext(2026);
      render(<KPICards {...getDefaultProps()} yearContext={futureYearContext} />);

      expect(screen.getByText("Future year")).toBeInTheDocument();
    });
  });

  describe("sessions unit", () => {
    it("displays correct title and unit for sessions", () => {
      render(<KPICards {...getDefaultProps()} unit="sessions" currentDistance={100} />);

      expect(screen.getByText("Current # Sessions")).toBeInTheDocument();
      expect(screen.getByText("100 sessions")).toBeInTheDocument();
      expect(screen.getByText(/sessions \/ day avg/)).toBeInTheDocument();
    });
  });

  describe("pace to goal variations", () => {
    it("hides pace value when shouldShowPacing is false", () => {
      const pastYearContext = createYearContext(2024);
      render(
        <KPICards {...getDefaultProps()} yearContext={pastYearContext} paceNeededForNextGoal={10} />
      );

      expect(screen.getByText("—")).toBeInTheDocument(); // Em dash, not pace value
      expect(screen.getByText("Historical data")).toBeInTheDocument();
    });

    it("shows days remaining when no pace needed", () => {
      render(<KPICards {...getDefaultProps()} paceNeededForNextGoal={0} nextGoalGap={0} />);

      expect(screen.getByText(/70 days remaining/)).toBeInTheDocument();
    });
  });
});
