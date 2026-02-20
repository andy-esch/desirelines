import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import Dashboard from "./Dashboard";
import { renderWithRouter } from "../test/renderWithRouter";

// Mock useAuth hook
vi.mock("../hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

// Mock useUserConfig hook (used by useMultiSportChartData for distance unit preference)
vi.mock("../hooks/useUserConfig", () => ({
  useUserConfig: vi.fn(() => ({ data: null, isLoading: false, error: null })),
}));

// Mock useDailySportData hook (used by MultiSportComparisonChart and ActivityCalendarHeatmap)
vi.mock("../hooks/useDailySportData", () => ({
  useDailySportData: vi.fn(() => ({
    data: { cycling: {}, running: {}, yoga: {} },
    isLoading: false,
    error: null,
  })),
}));

// Mock useActivities hook (used by RecentActivitiesList)
vi.mock("../hooks/useActivities", () => ({
  useActivities: vi.fn(() => ({
    activities: [],
    isLoading: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
    retry: vi.fn(),
  })),
}));

// Mock useVisibleSports hook (used by MultiSportComparisonChart)
vi.mock("../hooks/useVisibleSports", () => ({
  useVisibleSports: vi.fn(() => ({
    visibleSports: ["cycling", "running", "yoga"],
    setVisibleSports: vi.fn(),
    isLoading: false,
    error: null,
    isSaving: false,
    saveError: null,
    clearSaveError: vi.fn(),
  })),
}));

// Mock useSportConfig hook (used by MultiSportComparisonChart)
vi.mock("../hooks/useSportConfig", () => ({
  useSportConfig: vi.fn(() => ({
    sportConfig: {
      version: "1.0",
      sport_categories: {
        cycling: {
          display_name: "Cycling",
          strava_types: ["Ride"],
          excluded_types: [],
          primary_metric: "distance_meters",
          metrics: ["distance_meters", "time_minutes"],
          has_distance: true,
          has_elevation: true,
        },
        running: {
          display_name: "Running",
          strava_types: ["Run"],
          excluded_types: [],
          primary_metric: "distance_meters",
          metrics: ["distance_meters", "time_minutes"],
          has_distance: true,
          has_elevation: true,
        },
        yoga: {
          display_name: "Yoga",
          strava_types: ["Yoga"],
          excluded_types: [],
          primary_metric: "time_minutes",
          metrics: ["time_minutes", "activities"],
          has_distance: false,
          has_elevation: false,
        },
      },
    },
    isLoading: false,
    error: null,
    retry: vi.fn(),
  })),
}));

// Mock useWeeklySummary hook (used by WeeklySummaryCard)
vi.mock("../hooks/useWeeklySummary", () => ({
  useWeeklySummary: vi.fn(() => ({
    sportTotals: [],
    weekLabel: "Feb 3 – Feb 5",
    isLoading: false,
    error: null,
  })),
}));

// Mock useDashboardGoalData hook (used by GoalProgressCard + RecentActivitiesList)
vi.mock("../hooks/useDashboardGoalData", () => ({
  useDashboardGoalData: vi.fn(() => ({
    sportData: [],
    yearContext: { year: 2026, daysElapsed: 36, daysRemaining: 329, isPastYear: false },
    distanceUnit: "miles",
    isLoading: false,
    error: null,
  })),
}));

// Mock recharts to avoid rendering issues in tests
vi.mock("recharts", () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => <div data-testid="chart-line" />,
  XAxis: () => null,
  YAxis: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Tooltip: () => null,
}));

import { useAuth } from "../hooks/useAuth";
const mockUseAuth = vi.mocked(useAuth);

const mockSignIn = vi.fn();
const mockSignOut = vi.fn();

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loading state", () => {
    it("shows skeleton loading screen when auth is loading", async () => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: true,
        error: null,
        signIn: mockSignIn,
        signOut: mockSignOut,
      });
      const { container } = await renderWithRouter(<Dashboard />);

      // Wait for router to finish rendering the component
      await waitFor(() => {
        // DashboardSkeleton renders react-loading-skeleton elements
        expect(container.querySelectorAll(".react-loading-skeleton").length).toBeGreaterThan(0);
      });
      // Should not render the actual dashboard content
      expect(screen.queryByRole("heading", { name: /Welcome/i })).not.toBeInTheDocument();
    });
  });

  describe("unauthenticated user", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: false,
        error: null,
        signIn: mockSignIn,
        signOut: mockSignOut,
      });
    });

    it("renders welcome message without user name", async () => {
      await renderWithRouter(<Dashboard />);
      expect(screen.getByRole("heading", { name: "Welcome!" })).toBeInTheDocument();
    });

    it("shows sign-in prompt", async () => {
      await renderWithRouter(<Dashboard />);
      expect(screen.getByText("Interested in using Desire Lines?")).toBeInTheDocument();
      expect(screen.getByText(/Check back soon/)).toBeInTheDocument();
    });

    it("renders sparkline chart panels even with no data", async () => {
      await renderWithRouter(<Dashboard />);

      // Both panels always render — activity list shows its own empty state
      expect(screen.getByText("No activities in this time range")).toBeInTheDocument();
    });
  });

  describe("authenticated user", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: { displayName: "Jane Doe", uid: "123", email: "jane@example.com" },
        loading: false,
        error: null,
        signIn: mockSignIn,
        signOut: mockSignOut,
      });
    });

    it("renders personalized welcome message", async () => {
      await renderWithRouter(<Dashboard />);
      expect(screen.getByRole("heading", { name: /Welcome back, Jane/i })).toBeInTheDocument();
    });

    it("does not show sign-in prompt", async () => {
      await renderWithRouter(<Dashboard />);
      expect(screen.queryByText("Want to see your own data?")).not.toBeInTheDocument();
    });

    it("shows dashboard description", async () => {
      await renderWithRouter(<Dashboard />);
      expect(screen.getByText("Your multi-sport activity dashboard")).toBeInTheDocument();
    });
  });

  describe("dashboard sections", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: false,
        error: null,
        signIn: mockSignIn,
        signOut: mockSignOut,
      });
    });

    it("renders Recent Activity section", async () => {
      await renderWithRouter(<Dashboard />);
      expect(screen.getByRole("heading", { name: "Recent Activity" })).toBeInTheDocument();
    });

    it("renders time range selector", async () => {
      await renderWithRouter(<Dashboard />);
      // Time range selector is now part of the Dashboard
      expect(screen.getByRole("button", { name: "2W" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "YTD" })).toBeInTheDocument();
    });
  });
});
