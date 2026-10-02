import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DemoSportPage from "./DemoSportPage";
import type * as GoalCalcModule from "../utils/goalCalculations";
import { renderWithRouter } from "../test/renderWithRouter";
import { DemoStore } from "../test/fixtures/demoStore";
import { goalToDisplay } from "../utils/goalCalculations";
import { demoConfigKey, saveDemoSection } from "../services/demoStorage";

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
  isTimeSport: () => false,
}));

vi.mock("../config/metricConfig", () => ({
  getMetricConfig: () => ({ defaultGoalValue: 1000 }),
}));

vi.mock("../utils/units", () => ({
  getUserSettings: () => ({ distanceUnit: "miles", elevationUnit: "feet" }),
  getDisplayUnitForMetric: (metric: string, settings: { distanceUnit: string }) => {
    switch (metric) {
      case "distance_meters":
        return settings.distanceUnit;
      case "time_minutes":
        return "hours";
      case "activities":
        return "sessions";
      default:
        return settings.distanceUnit;
    }
  },
}));

vi.mock("../utils/goalCalculations", async (importOriginal) => {
  // Keep `buildGoal` (and any other future helpers DemoSportPage imports)
  // available from the real module; only stub the math we don't care about.
  const actual = await importOriginal<typeof GoalCalcModule>();
  return {
    ...actual,
    estimateYearEndDistance: () => 1000,
    // Identity converters keep test fixtures readable; the actual conversion is
    // exercised in goalCalculations / migration unit tests.
    goalToStorage: (value: number) => value,
    goalToDisplay: vi.fn((value: number) => value),
  };
});

// Stub SportPageContent to expose callbacks via test buttons
vi.mock("../components/SportPageContent", () => ({
  default: (props: {
    sport: string;
    currentYear: number;
    showAuthButton: boolean;
    goals: { value: number }[];
    onGoalsChange: (
      goals: { id: string; value: number; label: string; metric: string }[]
    ) => Promise<void>;
    onSportChange: (sport: string) => void;
    onYearChange: (year: number) => void;
    routePrefix: string;
  }) => (
    <div data-testid="sport-page-content">
      <span data-testid="goal-values">{props.goals.map((g) => g.value).join(",")}</span>
      <button
        data-testid="save-goals"
        onClick={() =>
          void props.onGoalsChange([{ id: "n", value: 42, label: "New", metric: "distance" }])
        }
      >
        Save Goals
      </button>
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
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      expect(screen.getByText("Demo Mode")).toBeInTheDocument();
      // Static page chrome, so not announced as an alert.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("year parsing", () => {
    it("parses a valid year string", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      expect(screen.getByTestId("current-year")).toHaveTextContent("2025");
    });

    it("falls back to current year for non-numeric year", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="abc" />, { wrapper: DemoStore });

      // Fallback year from useCurrentYear is 2026
      expect(screen.getByTestId("current-year")).toHaveTextContent("2026");
    });

    it("falls back to current year for empty string", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="" />, { wrapper: DemoStore });

      expect(screen.getByTestId("current-year")).toHaveTextContent("2026");
    });
  });

  describe("navigate callbacks", () => {
    it("navigates to /demo/$sport/$year on sport change", async () => {
      const user = userEvent.setup();
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      await user.click(screen.getByTestId("change-sport"));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/demo/$sport/$year",
        params: { sport: "cycling", year: "2025" },
      });
    });

    it("navigates to /demo/$sport/$year on year change", async () => {
      const user = userEvent.setup();
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      await user.click(screen.getByTestId("change-year"));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/demo/$sport/$year",
        params: { sport: "running", year: "2024" },
      });
    });
  });

  describe("demo-specific props", () => {
    it("passes showAuthButton as false", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      expect(screen.getByTestId("show-auth")).toHaveTextContent("false");
    });

    it("passes /demo as routePrefix", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      expect(screen.getByTestId("route-prefix")).toHaveTextContent("/demo");
    });
  });

  describe("stored demo goals", () => {
    const stored = (storageVersion?: number) =>
      saveDemoSection(
        "goals",
        {
          goals: [{ id: "a", value: 1609, label: "A", metric: "distance" }],
          ...(storageVersion === undefined ? {} : { storageVersion }),
        },
        2025,
        "running"
      );

    it("converts goals stored in canonical units (storageVersion 2) for display", async () => {
      stored(2);
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      await waitFor(() => expect(screen.getByTestId("goal-values")).toHaveTextContent("1609"));
      expect(vi.mocked(goalToDisplay)).toHaveBeenCalledWith(1609, expect.anything());
    });

    it("leaves older goals, saved before canonical units, in the units they were saved in", async () => {
      stored();
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      await waitFor(() => expect(screen.getByTestId("goal-values")).toHaveTextContent("1609"));
      // The starting goals, shown while the saved ones load, go through it; the saved one doesn't.
      expect(vi.mocked(goalToDisplay)).not.toHaveBeenCalledWith(1609, expect.anything());
    });

    it("shows the starting goals until any are saved", async () => {
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      expect(screen.getByTestId("goal-values")).toHaveTextContent("2000,2500,3000");
    });

    it("saves to the demo's own storage, canonical and versioned, and shows what it saved", async () => {
      const user = userEvent.setup();
      await renderWithRouter(<DemoSportPage sport="running" year="2025" />, { wrapper: DemoStore });

      await user.click(screen.getByTestId("save-goals"));

      await waitFor(() => expect(screen.getByTestId("goal-values")).toHaveTextContent("42"));
      const saved = JSON.parse(localStorage.getItem(demoConfigKey("goals", 2025, "running"))!) as {
        goals: { value: number }[];
        storageVersion: number;
      };
      expect(saved.storageVersion).toBe(2);
      expect(saved.goals.map((g) => g.value)).toEqual([42]);
    });
  });
});
