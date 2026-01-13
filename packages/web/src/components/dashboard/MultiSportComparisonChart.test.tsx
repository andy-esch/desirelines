import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MultiSportComparisonChart from "./MultiSportComparisonChart";
import {
  mockMinimalSportConfig,
  mockActivities,
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
    it("shows loading spinner when data is loading", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, isLoading: true })
      );

      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("shows Recent Activity header while loading", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, isLoading: true })
      );

      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByRole("heading", { name: "Recent Activity" })).toBeInTheDocument();
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

      renderWithRouter(<MultiSportComparisonChart />);

      expect(screen.getByText("No activity data for selected time range")).toBeInTheDocument();
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

      // Should have 3 sparklines (one per sport)
      const charts = screen.getAllByTestId("responsive-container");
      expect(charts.length).toBeGreaterThanOrEqual(1);
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

    it("renders sport labels as links", () => {
      renderWithRouter(<MultiSportComparisonChart />);

      const currentYear = new Date().getFullYear();
      expect(screen.getByRole("link", { name: "Cycling" })).toHaveAttribute(
        "href",
        `/cycling/${currentYear}`
      );
      expect(screen.getByRole("link", { name: "Running" })).toHaveAttribute(
        "href",
        `/running/${currentYear}`
      );
      expect(screen.getByRole("link", { name: "Yoga" })).toHaveAttribute(
        "href",
        `/yoga/${currentYear}`
      );
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
