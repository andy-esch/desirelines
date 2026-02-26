import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DemoSportPage from "./DemoSportPage";
import { renderWithRouter } from "../test/renderWithRouter";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual("@tanstack/react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock("../hooks/useCurrentYear", () => ({
  useCurrentYear: () => 2026,
}));

vi.mock("../hooks/useUserProfile", () => ({
  useUserProfile: () => ({ displayName: "Athlete", loading: false }),
}));

vi.mock("../hooks/useDemoData", () => ({
  useDemoData: () => ({
    metrics: null,
    sportConfig: null,
    isLoading: false,
    error: null,
  }),
  getDemoGoalsForSport: () => ({
    conservative: 2000,
    target: 2500,
    stretch: 3000,
  }),
}));

vi.mock("../hooks/useSidebarSportData", () => ({
  useDemoSidebarSportData: () => ({
    availableSports: ["running", "cycling"],
    sportCounts: { running: 10, cycling: 5 },
  }),
}));

vi.mock("../hooks/useTrainingMomentum", () => ({
  useTrainingMomentum: () => ({
    momentumLevel: "steady",
    trainingMomentum: 0.5,
  }),
}));

vi.mock("../hooks/useGoalStats", () => ({
  useGoalStats: () => ({
    nextGoal: null,
    nextGoalProgress: 0,
    nextGoalGap: 0,
    paceNeededForNextGoal: 0,
  }),
}));

vi.mock("../hooks/useSportPageData", () => ({
  convertMetricsToChartData: () => [],
}));

vi.mock("../utils/yearContext", () => ({
  createYearContext: (year: number) => ({
    year,
    daysElapsed: 180,
    daysRemaining: 185,
    isCurrentYear: false,
  }),
}));

vi.mock("../utils/dateCalculations", () => ({
  calculateAveragePace: () => 5,
}));

vi.mock("../utils/sportConfig", () => ({
  getPrimaryMetric: () => "distance",
}));

vi.mock("../config/metricConfig", () => ({
  getMetricConfig: () => ({ defaultGoalValue: 1000 }),
}));

vi.mock("../utils/units", () => ({
  getUserSettings: () => ({ distanceUnit: "km", elevationUnit: "m" }),
}));

vi.mock("../utils/goalCalculations", () => ({
  estimateYearEndDistance: () => 1000,
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

describe("DemoSportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe("demo banner", () => {
    it("renders the demo mode banner", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />);

      expect(screen.getByText("Demo Mode")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  describe("year parsing", () => {
    it("parses a valid year string", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />);

      expect(screen.getByTestId("current-year")).toHaveTextContent("2025");
    });

    it("falls back to current year for non-numeric year", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="abc" />);

      // Fallback year from useCurrentYear is 2026
      expect(screen.getByTestId("current-year")).toHaveTextContent("2026");
    });

    it("falls back to current year for empty string", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="" />);

      expect(screen.getByTestId("current-year")).toHaveTextContent("2026");
    });
  });

  describe("navigate callbacks", () => {
    it("navigates to /demo/$sport/$year on sport change", async () => {
      const user = userEvent.setup();
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />);

      await user.click(screen.getByTestId("change-sport"));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/demo/$sport/$year",
        params: { sport: "cycling", year: "2025" },
      });
    });

    it("navigates to /demo/$sport/$year on year change", async () => {
      const user = userEvent.setup();
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />);

      await user.click(screen.getByTestId("change-year"));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/demo/$sport/$year",
        params: { sport: "running", year: "2024" },
      });
    });
  });

  describe("demo-specific props", () => {
    it("passes showAuthButton as false", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />);

      expect(screen.getByTestId("show-auth")).toHaveTextContent("false");
    });

    it("passes /demo as routePrefix", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />);

      expect(screen.getByTestId("route-prefix")).toHaveTextContent("/demo");
    });
  });
});
