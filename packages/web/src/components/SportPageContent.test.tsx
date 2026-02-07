import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SportPageContent, { type SportPageContentProps } from "./SportPageContent";
import { createYearContext } from "../utils/yearContext";

// Mock heavy chart components to keep tests fast and focused on layout logic
vi.mock("./charts/CumulativeMetricsChart", () => ({
  default: () => <div data-testid="cumulative-chart" />,
}));
vi.mock("./charts/PacingMetricsChart", () => ({
  default: () => <div data-testid="pacing-chart" />,
}));
vi.mock("./charts/MetricSelector", () => ({
  default: ({
    availableMetrics,
    selectedMetric,
  }: {
    availableMetrics: string[];
    selectedMetric: string;
  }) => (
    <div data-testid="metric-selector">
      {availableMetrics.join(",")} | {selectedMetric}
    </div>
  ),
}));
vi.mock("./layout/Sidebar", () => ({
  default: ({ showAuthButton }: { showAuthButton?: boolean }) => (
    <div data-testid="sidebar" data-auth-button={showAuthButton} />
  ),
}));
vi.mock("./GoalControls", () => ({
  default: () => <div data-testid="goal-controls" />,
}));
vi.mock("./dashboard/KPICards", () => ({
  default: () => <div data-testid="kpi-cards" />,
}));
vi.mock("./GoalSummaryTable", () => ({
  default: () => <div data-testid="goal-summary-table" />,
}));

const baseProps: SportPageContentProps = {
  sport: "cycling",
  currentYear: 2025,
  yearContext: createYearContext(2025),
  chartData: [
    { x: "2025-01-15", y: 100 },
    { x: "2025-02-15", y: 300 },
  ],
  currentValue: 300,
  estimatedYearEnd: 2000,
  isLoading: false,
  error: null,
  unit: "miles",
  goals: [
    { id: "1", value: 1000, label: "Conservative" },
    { id: "2", value: 2000, label: "Target" },
  ],
  chartGoals: [
    { id: "1", value: 1000, label: "Conservative" },
    { id: "2", value: 2000, label: "Target" },
  ],
  onGoalsChange: vi.fn(),
  isGoalsSaving: false,
  goalsSaveError: null,
  nextGoal: { id: "1", value: 1000, label: "Conservative" },
  nextGoalProgress: 30,
  nextGoalGap: 700,
  paceNeededForNextGoal: 2.5,
  averagePace: 3,
  momentumIndicator: <span>steady</span>,
  availableSports: ["cycling", "running"],
  sportCounts: { cycling: 50, running: 30 },
  showAuthButton: true,
  onSportChange: vi.fn(),
  onYearChange: vi.fn(),
  routePrefix: "",
};

function renderContent(overrides: Partial<SportPageContentProps> = {}) {
  return render(
    <MemoryRouter>
      <SportPageContent {...baseProps} {...overrides} />
    </MemoryRouter>
  );
}

describe("SportPageContent", () => {
  describe("core rendering", () => {
    it("renders sport title", () => {
      renderContent();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cycling 2025");
    });

    it("renders charts", () => {
      renderContent();
      expect(screen.getByTestId("cumulative-chart")).toBeInTheDocument();
      expect(screen.getByTestId("pacing-chart")).toBeInTheDocument();
    });

    it("renders KPI cards", () => {
      renderContent();
      expect(screen.getByTestId("kpi-cards")).toBeInTheDocument();
    });

    it("renders goal summary table when data exists", () => {
      renderContent();
      expect(screen.getByTestId("goal-summary-table")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("renders EmptyState when no chart data and not loading", () => {
      renderContent({ chartData: [], currentValue: 0 });
      expect(screen.getByText("No")).toBeInTheDocument();
      expect(screen.getByText("data")).toBeInTheDocument();
      expect(screen.getByText("available")).toBeInTheDocument();
    });
  });

  describe("no-data banner", () => {
    it("shows no-data banner with correct routePrefix link", () => {
      const thisYear = new Date().getFullYear();
      renderContent({
        currentYear: thisYear,
        currentValue: 0,
        yearContext: createYearContext(thisYear),
        routePrefix: "/demo",
      });

      const link = screen.getByRole("link", {
        name: new RegExp(`View ${thisYear - 1} instead`),
      });
      expect(link).toHaveAttribute("href", `/demo/cycling/${thisYear - 1}`);
    });

    it("uses empty routePrefix for authenticated mode", () => {
      const thisYear = new Date().getFullYear();
      renderContent({
        currentYear: thisYear,
        currentValue: 0,
        yearContext: createYearContext(thisYear),
        routePrefix: "",
      });

      const link = screen.getByRole("link", {
        name: new RegExp(`View ${thisYear - 1} instead`),
      });
      expect(link).toHaveAttribute("href", `/cycling/${thisYear - 1}`);
    });

    it("does not show no-data banner for past years", () => {
      renderContent({
        currentYear: 2020,
        currentValue: 0,
        yearContext: createYearContext(2020),
      });

      expect(screen.queryByText(/View \d+ instead/)).not.toBeInTheDocument();
    });
  });

  describe("metric selector", () => {
    it("renders MetricSelector when multiple metrics and handler provided", () => {
      renderContent({
        availableMetrics: ["distance_meters", "time_minutes", "elevation_meters"],
        activeMetric: "distance_meters",
        onMetricChange: vi.fn(),
      });

      expect(screen.getByTestId("metric-selector")).toBeInTheDocument();
    });

    it("does not render MetricSelector when availableMetrics omitted", () => {
      renderContent({
        availableMetrics: undefined,
        activeMetric: undefined,
        onMetricChange: undefined,
      });

      expect(screen.queryByTestId("metric-selector")).not.toBeInTheDocument();
    });

    it("does not render MetricSelector for single metric", () => {
      renderContent({
        availableMetrics: ["distance_meters"],
        activeMetric: "distance_meters",
        onMetricChange: vi.fn(),
      });

      expect(screen.queryByTestId("metric-selector")).not.toBeInTheDocument();
    });
  });

  describe("sidebar auth button", () => {
    it("passes showAuthButton to Sidebar", () => {
      renderContent({ showAuthButton: true });
      expect(screen.getByTestId("sidebar")).toHaveAttribute("data-auth-button", "true");
    });

    it("hides auth button in demo mode", () => {
      renderContent({ showAuthButton: false });
      expect(screen.getByTestId("sidebar")).toHaveAttribute("data-auth-button", "false");
    });
  });
});
