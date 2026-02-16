import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MultiSportSparklineChart from "./MultiSportSparklineChart";
import {
  mockMinimalSportConfig,
  mockSportConfigReturn,
  mockVisibleSportsReturn,
  mockDailySportDataReturn,
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

// Mock useVisibleSports hook
vi.mock("../../hooks/useVisibleSports", () => ({
  useVisibleSports: vi.fn(),
}));

// Mock useSportConfig hook
vi.mock("../../hooks/useSportConfig", () => ({
  useSportConfig: vi.fn(),
}));

// Mock useUserConfig hook (used by useMultiSportChartData for distance unit preference)
vi.mock("../../hooks/useUserConfig", () => ({
  useUserConfig: vi.fn(() => ({ data: null, isLoading: false, error: null })),
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
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { useSportConfig } from "../../hooks/useSportConfig";

const mockUseDailySportData = vi.mocked(useDailySportData);
const mockUseAuth = vi.mocked(useAuth);
const mockUseVisibleSports = vi.mocked(useVisibleSports);
const mockUseSportConfig = vi.mocked(useSportConfig);

// Helper to render with router
function renderWithRouter(component: React.ReactElement) {
  return render(<MemoryRouter>{component}</MemoryRouter>);
}

describe("MultiSportSparklineChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: authenticated user
    mockUseAuth.mockReturnValue(mockAuthReturn());

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

      renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

      // Skeleton container has role="status" for accessibility
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading chart data");
    });
  });

  describe("error state", () => {
    it("shows error message when data fails to load", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, error: new Error("Failed to fetch") })
      );

      renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

      expect(screen.getByText("Failed to load chart data")).toBeInTheDocument();
    });
  });

  describe("with data", () => {
    beforeEach(() => {
      mockUseDailySportData.mockReturnValue({
        data: {
          cycling: {
            "2025-12-20": {
              distanceMeters: 20000,
              timeMinutes: 60,
              activities: 1,
              activityIds: [1],
            },
          },
          running: {
            "2025-12-21": {
              distanceMeters: 5000,
              timeMinutes: 30,
              activities: 1,
              activityIds: [4],
            },
          },
          yoga: {
            "2025-12-20": { timeMinutes: 30, activities: 1, activityIds: [7] },
          },
        },
        isLoading: false,
        error: null,
      });
    });

    it("renders sparklines for each sport", () => {
      renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
      expect(screen.getAllByTestId("chart-line")).toHaveLength(3);
    });

    it("renders sport labels as links to year with most recent activity", () => {
      renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

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
  });
});
