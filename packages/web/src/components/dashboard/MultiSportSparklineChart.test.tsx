import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import MultiSportSparklineChart from "./MultiSportSparklineChart";
import {
  mockMinimalSportConfig,
  mockSportConfigReturn,
  mockVisibleSportsReturn,
  mockDailySportDataReturn,
  mockAuthReturn,
  emptyDailySportData,
} from "../../test/fixtures/sportConfig";
import { renderWithRouter } from "../../test/renderWithRouter";
import { toLocalDateString } from "../../utils/dateUtils";

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

// Mock the unit reader (used by useMultiSportChartData for distance unit preference)
vi.mock("../../hooks/usePreferences", async () => {
  const { getUserSettings } = await import("../../utils/units");
  return { useUnitSettings: vi.fn(() => getUserSettings(null)) };
});

// The day a test hovers, and the chart's rows, so the Tooltip mock can render the chart's
// own tooltip content for that day as Recharts would.
const hover = vi.hoisted(() => ({
  date: null as string | null,
  rows: [] as Record<string, unknown>[],
}));

// Mock recharts to avoid rendering issues in tests
vi.mock("recharts", () => ({
  LineChart: ({ children, data }: { children: React.ReactNode; data: typeof hover.rows }) => {
    hover.rows = data;
    return <div data-testid="line-chart">{children}</div>;
  },
  Line: ({ stroke }: { stroke?: string }) => (
    <div
      data-testid={stroke === "var(--color-chart-line-casing)" ? "chart-casing" : "chart-line"}
    />
  ),
  XAxis: () => null,
  YAxis: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Tooltip: ({
    content,
  }: {
    content: (props: { active: boolean; payload: unknown[]; label: string }) => React.ReactNode;
  }) => {
    const row = hover.rows.find((r) => r.date === hover.date);
    return row ? content({ active: true, payload: [{ payload: row }], label: hover.date! }) : null;
  },
}));

import { useDailySportData } from "../../hooks/useDailySportData";
import { useAuth } from "../../hooks/useAuth";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { useSportConfig } from "../../hooks/useSportConfig";
import { useUnitSettings } from "../../hooks/usePreferences";
import { getUserSettings } from "../../utils/units";
import type { Preferences } from "../../services/userConfigService";

const mockUseDailySportData = vi.mocked(useDailySportData);
const mockUseAuth = vi.mocked(useAuth);
const mockUseVisibleSports = vi.mocked(useVisibleSports);
const mockUseSportConfig = vi.mocked(useSportConfig);

describe("MultiSportSparklineChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hover.date = null;

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
    it("shows skeleton loaders when data is loading", async () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, isLoading: true })
      );

      await renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

      // Skeleton container has role="status" for accessibility
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading chart data");
    });
  });

  describe("error state", () => {
    it("shows error message when data fails to load", async () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, error: new Error("Failed to fetch") })
      );

      await renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

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

    it("renders sparklines for each sport", async () => {
      await renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
      expect(screen.getAllByTestId("chart-line")).toHaveLength(3);
    });

    it("draws each sport's line over a casing in the theme's casing color", async () => {
      await renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

      const marks = screen.getAllByTestId(/^chart-(casing|line)$/);
      expect(marks.map((m) => m.dataset.testid)).toEqual([
        ...Array<string>(3).fill("chart-casing"),
        ...Array<string>(3).fill("chart-line"),
      ]);
    });

    it("renders sport labels as links to year with most recent activity", async () => {
      await renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

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

  describe("tooltip", () => {
    const today = toLocalDateString(new Date());
    const yesterday = toLocalDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));

    beforeEach(() => {
      // Back to the factory's default units after the unit test replaces them.
      vi.mocked(useUnitSettings).mockReset();
      mockUseDailySportData.mockReturnValue({
        data: {
          cycling: { [today]: { distanceMeters: 20000, activities: 1, activityIds: [1] } },
          running: { [today]: { distanceMeters: 5000, activities: 1, activityIds: [2] } },
          yoga: { [today]: { timeMinutes: 90, activities: 1, activityIds: [3] } },
        },
        isLoading: false,
        error: null,
      });
    });

    /** The value the tooltip shows beside a sport's name (the legend's links name it too). */
    const valueFor = (name: string) =>
      screen.getAllByText(name, { selector: "span" }).find((el) => !el.closest("a"))!
        .nextElementSibling as HTMLElement;

    it("formats each sport's value for its primary metric", async () => {
      hover.date = today;
      await renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

      // 20 km is 12.4 mi: one decimal from ten up, two below.
      expect(valueFor("Cycling")).toHaveTextContent("12.4 mi");
      expect(valueFor("Running")).toHaveTextContent("3.11 mi");
      expect(valueFor("Yoga")).toHaveTextContent("1 hr 30 min");
    });

    it("converts distances to the athlete's unit", async () => {
      vi.mocked(useUnitSettings).mockReturnValue(
        getUserSettings({ distanceUnit: "kilometers" } as Preferences)
      );
      hover.date = today;
      await renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

      expect(valueFor("Cycling")).toHaveTextContent("20.0 km");
      expect(valueFor("Running")).toHaveTextContent("5.00 km");
    });

    it("marks a quiet day's value as missing for every sport", async () => {
      hover.date = yesterday;
      await renderWithRouter(<MultiSportSparklineChart timeRange="2weeks" />);

      for (const name of ["Cycling", "Running", "Yoga"]) {
        expect(valueFor(name)).toHaveTextContent("none");
      }
    });
  });
});
