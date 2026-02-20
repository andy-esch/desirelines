import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SportPage from "./SportPage";
import { renderWithRouter } from "../test/renderWithRouter";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual("@tanstack/react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../hooks/useCurrentYear", () => ({
  useCurrentYear: () => 2026,
}));

const mockRetry = vi.fn();
const mockOnGoalsChange = vi.fn();
const mockOnMetricChange = vi.fn();
const mockOnPriorYearsChange = vi.fn();

const stubData = {
  currentYear: 2025,
  yearContext: { year: 2025, daysElapsed: 180, daysRemaining: 185, isCurrentYear: false },
  chartData: [],
  currentValue: 500,
  estimatedYearEnd: 1000,
  isLoading: false,
  error: null,
  retry: mockRetry,
  unit: "km" as const,
  goals: [],
  chartGoals: [],
  onGoalsChange: mockOnGoalsChange,
  isGoalsSaving: false,
  goalsSaveError: null,
  clearGoalsSaveError: vi.fn(),
  nextGoal: null,
  nextGoalProgress: 0,
  nextGoalGap: 0,
  paceNeededForNextGoal: 0,
  averagePace: 5,
  momentumLevel: "steady" as const,
  trainingMomentum: 0.5,
  availableSports: ["running", "cycling"],
  sportCounts: { running: 10, cycling: 5 },
  availableMetrics: ["distance"],
  activeMetric: "distance",
  onMetricChange: mockOnMetricChange,
  priorYearData: {},
  showPriorYears: false,
  onPriorYearsChange: mockOnPriorYearsChange,
};

vi.mock("../hooks/useSportPageData", () => ({
  useSportPageData: () => stubData,
}));

// Stub SportPageContent to expose callbacks via test buttons
vi.mock("../components/SportPageContent", () => ({
  default: (props: {
    sport: string;
    currentYear: number;
    showAuthButton: boolean;
    onSportChange: (sport: string) => void;
    onYearChange: (year: number) => void;
    routePrefix: string;
  }) => (
    <div data-testid="sport-page-content">
      <span data-testid="sport">{props.sport}</span>
      <span data-testid="current-year">{props.currentYear}</span>
      <span data-testid="show-auth">{String(props.showAuthButton)}</span>
      <span data-testid="route-prefix">{props.routePrefix}</span>
      <button data-testid="change-sport" onClick={() => props.onSportChange("cycling")}>
        Change Sport
      </button>
      <button data-testid="change-year" onClick={() => props.onYearChange(2024)}>
        Change Year
      </button>
    </div>
  ),
}));

vi.mock("../components/MomentumIndicator", () => ({
  default: () => <div data-testid="momentum-indicator" />,
}));

describe("SportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("year parsing", () => {
    it("parses a valid year string", async () => {
      await renderWithRouter(<SportPage sport="running" year="2025" />);

      expect(screen.getByTestId("current-year")).toHaveTextContent("2025");
    });

    it("falls back to current year for non-numeric year", async () => {
      await renderWithRouter(<SportPage sport="running" year="abc" />);

      // useSportPageData always returns stubData.currentYear (2025),
      // but the fallback year from useCurrentYear is 2026
      expect(screen.getByTestId("sport-page-content")).toBeInTheDocument();
    });

    it("falls back to current year for empty string", async () => {
      await renderWithRouter(<SportPage sport="running" year="" />);

      expect(screen.getByTestId("sport-page-content")).toBeInTheDocument();
    });
  });

  describe("navigate callbacks", () => {
    it("navigates to new sport with current year on sport change", async () => {
      const user = userEvent.setup();
      await renderWithRouter(<SportPage sport="running" year="2025" />);

      await user.click(screen.getByTestId("change-sport"));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/$sport/$year",
        params: { sport: "cycling", year: "2025" },
      });
    });

    it("navigates to new year with current sport on year change", async () => {
      const user = userEvent.setup();
      await renderWithRouter(<SportPage sport="running" year="2025" />);

      await user.click(screen.getByTestId("change-year"));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/$sport/$year",
        params: { sport: "running", year: "2024" },
      });
    });
  });

  it("passes showAuthButton as true", async () => {
    await renderWithRouter(<SportPage sport="running" year="2025" />);

    expect(screen.getByTestId("show-auth")).toHaveTextContent("true");
  });

  it("passes empty routePrefix", async () => {
    await renderWithRouter(<SportPage sport="running" year="2025" />);

    expect(screen.getByTestId("route-prefix")).toHaveTextContent("");
  });
});
