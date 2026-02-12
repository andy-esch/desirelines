import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MultiSportComparisonChart from "./MultiSportComparisonChart";
import {
  mockMinimalSportConfig,
  mockSportConfigReturn,
  mockVisibleSportsReturn,
  mockDailySportDataReturn,
  mockActivitiesReturn,
  mockAuthReturn,
  emptyDailySportData,
} from "../../test/fixtures/sportConfig";

// Mock useDailySportData hook
vi.mock("../../hooks/useDailySportData", () => ({
  useDailySportData: vi.fn(),
}));

// Mock useAuth hook
vi.mock("../../hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

// Mock useActivities hook
vi.mock("../../hooks/useActivities", () => ({
  useActivities: vi.fn(),
}));

// Mock useVisibleSports hook
vi.mock("../../hooks/useVisibleSports", () => ({
  useVisibleSports: vi.fn(),
}));

// Mock useSportConfig hook
vi.mock("../../hooks/useSportConfig", () => ({
  useSportConfig: vi.fn(),
}));

// Mock useDashboardGoalData hook (used by RecentActivitiesList for impact % column + distance unit)
vi.mock("../../hooks/useDashboardGoalData", () => ({
  useDashboardGoalData: vi.fn(() => ({
    sportData: [],
    yearContext: { year: 2025, dayOfYear: 1, daysInYear: 365, fractionElapsed: 0 },
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

import { useDailySportData } from "../../hooks/useDailySportData";
import { useAuth } from "../../hooks/useAuth";
import { useActivities } from "../../hooks/useActivities";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { useSportConfig } from "../../hooks/useSportConfig";

const mockUseDailySportData = vi.mocked(useDailySportData);
const mockUseAuth = vi.mocked(useAuth);
const mockUseActivities = vi.mocked(useActivities);
const mockUseVisibleSports = vi.mocked(useVisibleSports);
const mockUseSportConfig = vi.mocked(useSportConfig);

// Helper to render with router
function renderWithRouter(component: React.ReactElement) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

describe("MultiSportComparisonChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: authenticated user with activities
    mockUseAuth.mockReturnValue(mockAuthReturn());

    mockUseActivities.mockReturnValue(mockActivitiesReturn({ hasMore: true }));

    // Default: user has 3 visible sports
    mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn());

    // Default: sport config loaded (using minimal config with 3 sports)
    mockUseSportConfig.mockReturnValue(
      mockSportConfigReturn({ sportConfig: mockMinimalSportConfig })
    );
  });

  describe("loading state", () => {
    it("shows skeleton loaders when data is loading", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, isLoading: true })
      );

      renderWithRouter(<MultiSportComparisonChart />);

      // Skeleton container has role="status" for accessibility
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading activity data");
    });

    it("shows Recent Activity header while loading", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, isLoading: true })
      );

      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByRole("heading", { name: "Recent Activity" })).toBeInTheDocument();
    });

    it("shows skeleton loaders when useVisibleSports is loading", () => {
      // Data is ready, but visible sports preferences are still loading
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData })
      );
      mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn({ isLoading: true }));

      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading activity data");
    });

    it("shows skeleton loaders when useSportConfig is loading", () => {
      // Data is ready, but sport config is still loading
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData })
      );
      mockUseSportConfig.mockReturnValue(
        mockSportConfigReturn({ sportConfig: null, isLoading: true })
      );

      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading activity data");
    });

    it("shows skeleton loaders when all hooks are loading simultaneously", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, isLoading: true })
      );
      mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn({ isLoading: true }));
      mockUseSportConfig.mockReturnValue(
        mockSportConfigReturn({ sportConfig: null, isLoading: true })
      );

      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows error message when data fails to load", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, error: new Error("Failed to fetch") })
      );

      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByText("Failed to load activity data")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows no data message when no activities", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData })
      );
      mockUseActivities.mockReturnValue(mockActivitiesReturn({ activities: [] }));

      renderWithRouter(<MultiSportComparisonChart />);

      // Sparklines still render; activity list shows its own empty message
      expect(screen.getByText("No activities in this time range")).toBeInTheDocument();
    });
  });

  describe("with data", () => {
    beforeEach(() => {
      // New format: Record<string, DailyActivity> maps (keyed by date)
      mockUseDailySportData.mockReturnValue({
        data: {
          cycling: {
            "2025-12-20": {
              distanceMeters: 20000,
              timeMinutes: 60,
              activities: 1,
              activityIds: [1],
            },
            "2025-12-22": {
              distanceMeters: 50000,
              timeMinutes: 120,
              activities: 2,
              activityIds: [2, 3],
            },
          },
          running: {
            "2025-12-21": {
              distanceMeters: 5000,
              timeMinutes: 30,
              activities: 1,
              activityIds: [4],
            },
            "2025-12-23": {
              distanceMeters: 10000,
              timeMinutes: 50,
              activities: 2,
              activityIds: [5, 6],
            },
          },
          yoga: {
            "2025-12-20": { timeMinutes: 30, activities: 1, activityIds: [7] },
            "2025-12-24": { timeMinutes: 75, activities: 2, activityIds: [8, 9] },
          },
        },
        isLoading: false,
        error: null,
      });
    });

    it("renders sparklines for each sport", () => {
      renderWithRouter(<MultiSportComparisonChart />);

      // Should have 1 unified chart with 3 lines (one per sport)
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
      expect(screen.getAllByTestId("chart-line")).toHaveLength(3);
    });

    it("renders chart heading", () => {
      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByRole("heading", { name: "Recent Activity" })).toBeInTheDocument();
    });

    it("renders time range selector", () => {
      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByRole("button", { name: "2W" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "4W" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "YTD" })).toBeInTheDocument();
    });

    it("renders sport labels as links to year with most recent activity", () => {
      renderWithRouter(<MultiSportComparisonChart />);

      // Mock data has dates in 2025, so links should point to 2025
      // (not current year) based on most recent activity date
      expect(screen.getByRole("link", { name: "Cycling" })).toHaveAttribute(
        "href",
        "/cycling/2025"
      );
      expect(screen.getByRole("link", { name: "Running" })).toHaveAttribute(
        "href",
        "/running/2025"
      );
      expect(screen.getByRole("link", { name: "Yoga" })).toHaveAttribute("href", "/yoga/2025");
    });

    it("defaults to 2 weeks time range", () => {
      renderWithRouter(<MultiSportComparisonChart />);

      const twoWeeksBtn = screen.getByRole("button", { name: "2W" });
      expect(twoWeeksBtn).toHaveClass("btn-time-range-active");
    });

    it("changes time range when selector clicked", () => {
      renderWithRouter(<MultiSportComparisonChart />);

      const fourWeeksBtn = screen.getByRole("button", { name: "4W" });
      fireEvent.click(fourWeeksBtn);

      expect(fourWeeksBtn).toHaveClass("btn-time-range-active");
      expect(screen.getByRole("button", { name: "2W" })).toHaveClass("btn-time-range");
    });

    it("renders recent activities section", () => {
      renderWithRouter(<MultiSportComparisonChart />);

      // Check for activity links (demo data)
      expect(screen.getByRole("link", { name: "Morning Ride" })).toBeInTheDocument();
    });

    it("renders pagination controls for activities", () => {
      renderWithRouter(<MultiSportComparisonChart />);

      // Should have up/down buttons
      expect(screen.getByRole("button", { name: "Newer activities" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Older activities" })).toBeInTheDocument();
    });
  });

  describe("edge cases", () => {
    describe("empty visibleSports array", () => {
      it("still renders both panels when visibleSports is empty", () => {
        mockUseDailySportData.mockReturnValue(mockDailySportDataReturn({ data: {} }));
        mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn({ visibleSports: [] }));
        mockUseActivities.mockReturnValue(mockActivitiesReturn({ activities: [] }));

        renderWithRouter(<MultiSportComparisonChart />);

        // Both panels render — sparkline panel has no lines, activity list shows its own empty state
        expect(screen.getByText("No activities in this time range")).toBeInTheDocument();
        expect(screen.getByText("Recent Activity")).toBeInTheDocument();
      });

      it("does not crash when visibleSports is empty", () => {
        mockUseDailySportData.mockReturnValue(mockDailySportDataReturn({ data: {} }));
        mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn({ visibleSports: [] }));

        // Should render without throwing
        expect(() => renderWithRouter(<MultiSportComparisonChart />)).not.toThrow();
      });
    });

    describe("unknown sport (fallback color)", () => {
      it("renders sparkline for sport not in SPORT_COLORS with fallback color", () => {
        // Mock a sport that doesn't exist in SPORT_COLORS
        const unknownSportConfig = {
          version: "1.0",
          sport_categories: {
            unicycling: {
              display_name: "Unicycling",
              strava_types: ["Unicycle"],
              excluded_types: [],
              primary_metric: "distance_meters",
              metrics: ["distance_meters", "time_minutes"],
              has_distance: true,
              has_elevation: false,
            },
          },
        };

        mockUseVisibleSports.mockReturnValue(
          mockVisibleSportsReturn({ visibleSports: ["unicycling"] })
        );
        mockUseSportConfig.mockReturnValue(
          mockSportConfigReturn({ sportConfig: unknownSportConfig })
        );
        mockUseDailySportData.mockReturnValue({
          data: {
            unicycling: {
              "2026-01-02": {
                distanceMeters: 5000,
                timeMinutes: 30,
                activities: 1,
                activityIds: [1],
              },
            },
          },
          isLoading: false,
          error: null,
        });

        renderWithRouter(<MultiSportComparisonChart />);

        // Should render the sport label (uses fallback display name formatting)
        expect(screen.getByRole("link", { name: "Unicycling" })).toBeInTheDocument();
        // Should render a sparkline
        expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
      });
    });

    describe("dynamic height with different sport counts", () => {
      it("renders with single sport", () => {
        mockUseVisibleSports.mockReturnValue(
          mockVisibleSportsReturn({ visibleSports: ["cycling"] })
        );
        mockUseSportConfig.mockReturnValue(
          mockSportConfigReturn({
            sportConfig: {
              version: "1.0",
              sport_categories: {
                cycling: mockMinimalSportConfig.sport_categories.cycling,
              },
            },
          })
        );
        mockUseDailySportData.mockReturnValue({
          data: {
            cycling: {
              "2026-01-02": {
                distanceMeters: 20000,
                timeMinutes: 60,
                activities: 1,
                activityIds: [1],
              },
            },
          },
          isLoading: false,
          error: null,
        });

        renderWithRouter(<MultiSportComparisonChart />);

        // Should render 1 unified chart with 1 line (single sport)
        expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
        expect(screen.getAllByTestId("chart-line")).toHaveLength(1);
        expect(screen.getByRole("link", { name: "Cycling" })).toBeInTheDocument();
      });

      it("renders with 5 sports", () => {
        const fiveSportConfig = {
          version: "1.0",
          sport_categories: {
            cycling: mockMinimalSportConfig.sport_categories.cycling,
            running: mockMinimalSportConfig.sport_categories.running,
            yoga: mockMinimalSportConfig.sport_categories.yoga,
            swimming: {
              display_name: "Swimming",
              strava_types: ["Swim"],
              excluded_types: [],
              primary_metric: "distance_meters",
              metrics: ["distance_meters", "time_minutes"],
              has_distance: true,
              has_elevation: false,
            },
            hiking: {
              display_name: "Hiking",
              strava_types: ["Hike"],
              excluded_types: [],
              primary_metric: "distance_meters",
              metrics: ["distance_meters", "time_minutes", "elevation_meters"],
              has_distance: true,
              has_elevation: true,
            },
          },
        };

        mockUseVisibleSports.mockReturnValue(
          mockVisibleSportsReturn({
            visibleSports: ["cycling", "running", "yoga", "swimming", "hiking"],
          })
        );
        mockUseSportConfig.mockReturnValue(mockSportConfigReturn({ sportConfig: fiveSportConfig }));
        mockUseDailySportData.mockReturnValue({
          data: {
            cycling: {
              "2026-01-02": {
                distanceMeters: 20000,
                timeMinutes: 60,
                activities: 1,
                activityIds: [1],
              },
            },
            running: {
              "2026-01-02": {
                distanceMeters: 5000,
                timeMinutes: 30,
                activities: 1,
                activityIds: [2],
              },
            },
            yoga: { "2026-01-02": { timeMinutes: 30, activities: 1, activityIds: [3] } },
            swimming: {
              "2026-01-02": {
                distanceMeters: 2000,
                timeMinutes: 45,
                activities: 1,
                activityIds: [4],
              },
            },
            hiking: {
              "2026-01-02": {
                distanceMeters: 10000,
                timeMinutes: 120,
                activities: 1,
                activityIds: [5],
              },
            },
          },
          isLoading: false,
          error: null,
        });

        renderWithRouter(<MultiSportComparisonChart />);

        // Should render 1 unified chart with 5 lines (one per sport)
        expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
        expect(screen.getAllByTestId("chart-line")).toHaveLength(5);
        expect(screen.getByRole("link", { name: "Cycling" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Running" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Yoga" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Swimming" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Hiking" })).toBeInTheDocument();
      });

      it("renders with 10 sports (approaching MAX_SPORTS_DISPLAY)", () => {
        const tenSportConfig = {
          version: "1.0",
          sport_categories: {
            cycling: {
              display_name: "Cycling",
              strava_types: ["Ride"],
              excluded_types: [],
              primary_metric: "distance_meters",
              metrics: ["distance_meters"],
              has_distance: true,
              has_elevation: true,
            },
            running: {
              display_name: "Running",
              strava_types: ["Run"],
              excluded_types: [],
              primary_metric: "distance_meters",
              metrics: ["distance_meters"],
              has_distance: true,
              has_elevation: true,
            },
            yoga: {
              display_name: "Yoga",
              strava_types: ["Yoga"],
              excluded_types: [],
              primary_metric: "time_minutes",
              metrics: ["time_minutes"],
              has_distance: false,
              has_elevation: false,
            },
            swimming: {
              display_name: "Swimming",
              strava_types: ["Swim"],
              excluded_types: [],
              primary_metric: "distance_meters",
              metrics: ["distance_meters"],
              has_distance: true,
              has_elevation: false,
            },
            hiking: {
              display_name: "Hiking",
              strava_types: ["Hike"],
              excluded_types: [],
              primary_metric: "distance_meters",
              metrics: ["distance_meters"],
              has_distance: true,
              has_elevation: true,
            },
            walking: {
              display_name: "Walking",
              strava_types: ["Walk"],
              excluded_types: [],
              primary_metric: "distance_meters",
              metrics: ["distance_meters"],
              has_distance: true,
              has_elevation: false,
            },
            workout: {
              display_name: "Workout",
              strava_types: ["Workout"],
              excluded_types: [],
              primary_metric: "time_minutes",
              metrics: ["time_minutes"],
              has_distance: false,
              has_elevation: false,
            },
            climbing: {
              display_name: "Climbing",
              strava_types: ["RockClimbing"],
              excluded_types: [],
              primary_metric: "time_minutes",
              metrics: ["time_minutes"],
              has_distance: false,
              has_elevation: false,
            },
            skating: {
              display_name: "Skating",
              strava_types: ["IceSkate"],
              excluded_types: [],
              primary_metric: "distance_meters",
              metrics: ["distance_meters"],
              has_distance: true,
              has_elevation: false,
            },
            golf: {
              display_name: "Golf",
              strava_types: ["Golf"],
              excluded_types: [],
              primary_metric: "time_minutes",
              metrics: ["time_minutes"],
              has_distance: false,
              has_elevation: false,
            },
          },
        };

        const tenSports = Object.keys(tenSportConfig.sport_categories);
        mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn({ visibleSports: tenSports }));
        mockUseSportConfig.mockReturnValue(mockSportConfigReturn({ sportConfig: tenSportConfig }));

        // Create mock data for all 10 sports
        const mockData: Record<
          string,
          Record<
            string,
            {
              distanceMeters?: number;
              timeMinutes?: number;
              activities: number;
              activityIds: number[];
            }
          >
        > = {};
        tenSports.forEach((sport, index) => {
          mockData[sport] = {
            "2026-01-02": {
              distanceMeters: 10000,
              timeMinutes: 60,
              activities: 1,
              activityIds: [index + 1],
            },
          };
        });

        mockUseDailySportData.mockReturnValue({
          data: mockData,
          isLoading: false,
          error: null,
        });

        renderWithRouter(<MultiSportComparisonChart />);

        // Should render 1 unified chart with 10 lines (one per sport)
        expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
        expect(screen.getAllByTestId("chart-line")).toHaveLength(10);
      });
    });

    describe("stale preferences handling", () => {
      it("filters out sports from preferences that are not in config", () => {
        // User has "deleted_sport" in preferences but it's not in config
        mockUseVisibleSports.mockReturnValue(
          mockVisibleSportsReturn({ visibleSports: ["cycling", "deleted_sport", "running"] })
        );
        mockUseSportConfig.mockReturnValue(
          mockSportConfigReturn({ sportConfig: mockMinimalSportConfig })
        );
        mockUseDailySportData.mockReturnValue({
          data: {
            cycling: {
              "2026-01-02": {
                distanceMeters: 20000,
                timeMinutes: 60,
                activities: 1,
                activityIds: [1],
              },
            },
            running: {
              "2026-01-02": {
                distanceMeters: 5000,
                timeMinutes: 30,
                activities: 1,
                activityIds: [2],
              },
            },
          },
          isLoading: false,
          error: null,
        });

        renderWithRouter(<MultiSportComparisonChart />);

        // Should only render valid sports (cycling, running)
        expect(screen.getByRole("link", { name: "Cycling" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Running" })).toBeInTheDocument();
        expect(screen.queryByText("deleted_sport")).not.toBeInTheDocument();
      });
    });
  });

  describe("className prop", () => {
    it("applies custom className", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData })
      );

      const { container } = renderWithRouter(
        <MultiSportComparisonChart className="custom-class" />
      );

      expect(container.querySelector(".custom-class")).toBeInTheDocument();
    });
  });
});
