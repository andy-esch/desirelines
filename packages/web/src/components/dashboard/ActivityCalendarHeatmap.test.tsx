import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ActivityCalendarHeatmap from "./ActivityCalendarHeatmap";
import {
  mockMinimalSportConfig,
  mockSportConfigReturn,
  mockVisibleSportsReturn,
  mockDailySportDataReturn,
  emptyDailySportData,
} from "../../test/fixtures/sportConfig";
import type { MultiSportData } from "../../hooks/useDailySportData";

// Mock useDailySportData hook
vi.mock("../../hooks/useDailySportData", () => ({
  useDailySportData: vi.fn(),
}));

// Mock useVisibleSports hook
vi.mock("../../hooks/useVisibleSports", () => ({
  useVisibleSports: vi.fn(),
}));

// Mock useSportConfig hook
vi.mock("../../hooks/useSportConfig", () => ({
  useSportConfig: vi.fn(),
}));

import { useDailySportData } from "../../hooks/useDailySportData";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { useSportConfig } from "../../hooks/useSportConfig";

const mockUseDailySportData = vi.mocked(useDailySportData);
const mockUseVisibleSports = vi.mocked(useVisibleSports);
const mockUseSportConfig = vi.mocked(useSportConfig);

describe("ActivityCalendarHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("shows Activity Calendar header while loading", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, isLoading: true })
      );

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByText("Activity Calendar")).toBeInTheDocument();
    });

    it("shows loading spinner when useVisibleSports is loading", () => {
      // Data is ready, but visible sports preferences are still loading
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData })
      );
      mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn({ isLoading: true }));

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("shows loading spinner when useSportConfig is loading", () => {
      // Data is ready, but sport config is still loading
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData })
      );
      mockUseSportConfig.mockReturnValue(
        mockSportConfigReturn({ sportConfig: null, isLoading: true })
      );

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("shows loading spinner when all hooks are loading simultaneously", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, isLoading: true })
      );
      mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn({ isLoading: true }));
      mockUseSportConfig.mockReturnValue(
        mockSportConfigReturn({ sportConfig: null, isLoading: true })
      );

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows error message when data fails to load", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData, error: new Error("Failed to fetch") })
      );

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByText("Failed to load calendar data")).toBeInTheDocument();
    });
  });

  describe("with data", () => {
    beforeEach(() => {
      // Mock data with activities across different dates
      mockUseDailySportData.mockReturnValue({
        data: {
          cycling: {
            "2026-01-02": {
              distanceMeters: 20000,
              timeMinutes: 60,
              activities: 1,
              activityIds: [1],
            },
            "2026-01-03": {
              distanceMeters: 50000,
              timeMinutes: 120,
              activities: 2,
              activityIds: [2, 3],
            },
          },
          running: {
            "2026-01-02": {
              distanceMeters: 5000,
              timeMinutes: 30,
              activities: 1,
              activityIds: [4],
            },
          },
          yoga: {
            "2026-01-01": { timeMinutes: 30, activities: 1, activityIds: [5] },
          },
        },
        isLoading: false,
        error: null,
      });
    });

    it("renders Activity Calendar header with activity count for past 12 months", () => {
      render(<ActivityCalendarHeatmap />);

      expect(screen.getByText("Activity Calendar")).toBeInTheDocument();
      // Total: 1 (cycling) + 2 (cycling) + 1 (running) + 1 (yoga) = 5 activities
      expect(screen.getByText(/5 activities in past 12 months/)).toBeInTheDocument();
    });

    it("renders time range dropdown with Past 12 months as default", () => {
      render(<ActivityCalendarHeatmap />);

      const dropdown = screen.getByRole("combobox", { name: "Select time range" });
      expect(dropdown).toBeInTheDocument();
      expect(dropdown).toHaveValue("trailing12");
    });

    it("renders year options in dropdown", () => {
      render(<ActivityCalendarHeatmap />);

      expect(screen.getByRole("option", { name: "Past 12 months" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "2026" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "2025" })).toBeInTheDocument();
    });

    it("updates label when year is selected", () => {
      render(<ActivityCalendarHeatmap />);

      const dropdown = screen.getByRole("combobox", { name: "Select time range" });
      fireEvent.change(dropdown, { target: { value: "2025" } });

      expect(screen.getByText(/activities in 2025/)).toBeInTheDocument();
    });

    it("renders legend", () => {
      render(<ActivityCalendarHeatmap />);

      expect(screen.getByText("Less")).toBeInTheDocument();
      expect(screen.getByText("More")).toBeInTheDocument();
    });

    it("renders calendar cells with titles showing activity counts", () => {
      render(<ActivityCalendarHeatmap />);

      // 2026-01-02 should have 2 activities (1 cycling + 1 running)
      const jan2Cell = document.querySelector('[title="2026-01-02: 2 activities"]');
      expect(jan2Cell).toBeInTheDocument();

      // 2026-01-03 should have 2 activities (cycling)
      const jan3Cell = document.querySelector('[title="2026-01-03: 2 activities"]');
      expect(jan3Cell).toBeInTheDocument();

      // 2026-01-01 should have 1 activity (yoga)
      const jan1Cell = document.querySelector('[title="2026-01-01: 1 activity"]');
      expect(jan1Cell).toBeInTheDocument();
    });
  });

  describe("empty data", () => {
    it("renders calendar with 0 activities", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData })
      );

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByText("Activity Calendar")).toBeInTheDocument();
      expect(screen.getByText(/0 activities in past 12 months/)).toBeInTheDocument();
    });
  });

  describe("className prop", () => {
    it("applies custom className", () => {
      mockUseDailySportData.mockReturnValue(
        mockDailySportDataReturn({ data: emptyDailySportData })
      );

      const { container } = render(<ActivityCalendarHeatmap className="custom-class" />);

      expect(container.querySelector(".custom-class")).toBeInTheDocument();
    });
  });

  describe("sport filter toggle", () => {
    beforeEach(() => {
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
          yoga: {},
        },
        isLoading: false,
        error: null,
      });
    });

    it("renders sport filter toggle buttons", () => {
      render(<ActivityCalendarHeatmap />);

      const filterGroup = screen.getByRole("group", { name: "Sport filter" });
      expect(filterGroup).toBeInTheDocument();

      expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Visible" })).toBeInTheDocument();
    });

    it("defaults to All sports mode", () => {
      render(<ActivityCalendarHeatmap />);

      const allButton = screen.getByRole("button", { name: "All" });
      const visibleButton = screen.getByRole("button", { name: "Visible" });

      expect(allButton).toHaveAttribute("aria-pressed", "true");
      expect(visibleButton).toHaveAttribute("aria-pressed", "false");
    });

    it("switches to Visible sports mode when Visible button clicked", () => {
      render(<ActivityCalendarHeatmap />);

      const visibleButton = screen.getByRole("button", { name: "Visible" });
      fireEvent.click(visibleButton);

      expect(visibleButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    });

    it("Visible button shows tooltip with visible sports list", () => {
      render(<ActivityCalendarHeatmap />);

      const visibleButton = screen.getByRole("button", { name: "Visible" });
      expect(visibleButton).toHaveAttribute("title", "Show only: cycling, running, yoga");
    });
  });

  describe("edge cases", () => {
    describe("sport config with 10+ sports", () => {
      it("handles large sport config without errors", () => {
        const largeSportConfig = {
          version: "1.0",
          sportCategories: {
            cycling: {
              displayName: "Cycling",
              stravaTypes: ["Ride"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: true,
            },
            running: {
              displayName: "Running",
              stravaTypes: ["Run"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: true,
            },
            yoga: {
              displayName: "Yoga",
              stravaTypes: ["Yoga"],
              excludedTypes: [],
              primaryMetric: "time_minutes",
              metrics: ["time_minutes"],
              hasDistance: false,
              hasElevation: false,
            },
            swimming: {
              displayName: "Swimming",
              stravaTypes: ["Swim"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: false,
            },
            hiking: {
              displayName: "Hiking",
              stravaTypes: ["Hike"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: true,
            },
            walking: {
              displayName: "Walking",
              stravaTypes: ["Walk"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: false,
            },
            workout: {
              displayName: "Workout",
              stravaTypes: ["Workout"],
              excludedTypes: [],
              primaryMetric: "time_minutes",
              metrics: ["time_minutes"],
              hasDistance: false,
              hasElevation: false,
            },
            climbing: {
              displayName: "Climbing",
              stravaTypes: ["RockClimbing"],
              excludedTypes: [],
              primaryMetric: "time_minutes",
              metrics: ["time_minutes"],
              hasDistance: false,
              hasElevation: false,
            },
            skating: {
              displayName: "Skating",
              stravaTypes: ["IceSkate"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: false,
            },
            golf: {
              displayName: "Golf",
              stravaTypes: ["Golf"],
              excludedTypes: [],
              primaryMetric: "time_minutes",
              metrics: ["time_minutes"],
              hasDistance: false,
              hasElevation: false,
            },
            rowing: {
              displayName: "Rowing",
              stravaTypes: ["Rowing"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: false,
            },
            skiing: {
              displayName: "Skiing",
              stravaTypes: ["AlpineSki"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: true,
            },
          },
        };

        const allSports = Object.keys(largeSportConfig.sportCategories);
        mockUseSportConfig.mockReturnValue(
          mockSportConfigReturn({ sportConfig: largeSportConfig })
        );
        mockUseVisibleSports.mockReturnValue(
          mockVisibleSportsReturn({ visibleSports: allSports.slice(0, 5) })
        );

        // Create mock data for some sports
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
        allSports.forEach((sport, index) => {
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

        // Should render without throwing
        expect(() => render(<ActivityCalendarHeatmap />)).not.toThrow();
        expect(screen.getByText("Activity Calendar")).toBeInTheDocument();

        // With 12 sports, total should be 12 activities
        expect(screen.getByText(/12 activities in past 12 months/)).toBeInTheDocument();
      });

      it("correctly counts activities across all sports in All mode", () => {
        const sixSportConfig = {
          version: "1.0",
          sportCategories: {
            cycling: {
              displayName: "Cycling",
              stravaTypes: ["Ride"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: true,
            },
            running: {
              displayName: "Running",
              stravaTypes: ["Run"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: true,
            },
            yoga: {
              displayName: "Yoga",
              stravaTypes: ["Yoga"],
              excludedTypes: [],
              primaryMetric: "time_minutes",
              metrics: ["time_minutes"],
              hasDistance: false,
              hasElevation: false,
            },
            swimming: {
              displayName: "Swimming",
              stravaTypes: ["Swim"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: false,
            },
            hiking: {
              displayName: "Hiking",
              stravaTypes: ["Hike"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: true,
            },
            walking: {
              displayName: "Walking",
              stravaTypes: ["Walk"],
              excludedTypes: [],
              primaryMetric: "distance_meters",
              metrics: ["distance_meters"],
              hasDistance: true,
              hasElevation: false,
            },
          },
        };

        mockUseSportConfig.mockReturnValue(mockSportConfigReturn({ sportConfig: sixSportConfig }));
        mockUseVisibleSports.mockReturnValue(
          mockVisibleSportsReturn({ visibleSports: ["cycling", "running"] })
        );

        // Each sport has 2 activities on the same day
        mockUseDailySportData.mockReturnValue({
          data: {
            cycling: {
              "2026-01-02": { distanceMeters: 20000, activities: 2, activityIds: [1, 2] },
            },
            running: {
              "2026-01-02": { distanceMeters: 10000, activities: 2, activityIds: [3, 4] },
            },
            yoga: { "2026-01-02": { timeMinutes: 60, activities: 1, activityIds: [5] } },
            swimming: { "2026-01-02": { distanceMeters: 2000, activities: 1, activityIds: [6] } },
            hiking: { "2026-01-02": { distanceMeters: 15000, activities: 1, activityIds: [7] } },
            walking: { "2026-01-02": { distanceMeters: 5000, activities: 1, activityIds: [8] } },
          },
          isLoading: false,
          error: null,
        });

        render(<ActivityCalendarHeatmap />);

        // Default is "All" mode, so should count all 8 activities
        expect(screen.getByText(/8 activities in past 12 months/)).toBeInTheDocument();
      });
    });

    describe("sport filter mode changes", () => {
      it("updates activity count when switching from All to Visible mode", () => {
        mockUseSportConfig.mockReturnValue(
          mockSportConfigReturn({ sportConfig: mockMinimalSportConfig })
        );
        mockUseVisibleSports.mockReturnValue(
          mockVisibleSportsReturn({ visibleSports: ["cycling"] }) // Only cycling is visible
        );

        // Data for all 3 sports
        mockUseDailySportData.mockReturnValue({
          data: {
            cycling: {
              "2026-01-02": { distanceMeters: 20000, activities: 2, activityIds: [1, 2] },
            },
            running: {
              "2026-01-02": { distanceMeters: 10000, activities: 3, activityIds: [3, 4, 5] },
            },
            yoga: { "2026-01-02": { timeMinutes: 60, activities: 1, activityIds: [6] } },
          },
          isLoading: false,
          error: null,
        });

        render(<ActivityCalendarHeatmap />);

        // Default "All" mode shows all 6 activities
        expect(screen.getByText(/6 activities in past 12 months/)).toBeInTheDocument();

        // Switch to "Visible" mode
        const visibleButton = screen.getByRole("button", { name: "Visible" });
        fireEvent.click(visibleButton);

        // Now should only show cycling's 2 activities
        expect(screen.getByText(/2 activities in past 12 months/)).toBeInTheDocument();
      });

      it("updates activity count when switching from Visible to All mode", () => {
        mockUseSportConfig.mockReturnValue(
          mockSportConfigReturn({ sportConfig: mockMinimalSportConfig })
        );
        mockUseVisibleSports.mockReturnValue(
          mockVisibleSportsReturn({ visibleSports: ["yoga"] }) // Only yoga is visible
        );

        mockUseDailySportData.mockReturnValue({
          data: {
            cycling: {
              "2026-01-02": { distanceMeters: 20000, activities: 5, activityIds: [1, 2, 3, 4, 5] },
            },
            running: {
              "2026-01-02": { distanceMeters: 10000, activities: 3, activityIds: [6, 7, 8] },
            },
            yoga: { "2026-01-02": { timeMinutes: 60, activities: 2, activityIds: [9, 10] } },
          },
          isLoading: false,
          error: null,
        });

        render(<ActivityCalendarHeatmap />);

        // Switch to "Visible" mode first
        const visibleButton = screen.getByRole("button", { name: "Visible" });
        fireEvent.click(visibleButton);

        // Should only show yoga's 2 activities
        expect(screen.getByText(/2 activities in past 12 months/)).toBeInTheDocument();

        // Switch back to "All" mode
        const allButton = screen.getByRole("button", { name: "All" });
        fireEvent.click(allButton);

        // Now should show all 10 activities
        expect(screen.getByText(/10 activities in past 12 months/)).toBeInTheDocument();
      });
    });

    describe("empty visibleSports array", () => {
      it("falls back to default sports when visibleSports is empty", () => {
        mockUseSportConfig.mockReturnValue(
          mockSportConfigReturn({ sportConfig: mockMinimalSportConfig })
        );
        mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn({ visibleSports: [] }));
        mockUseDailySportData.mockReturnValue({
          data: {
            cycling: { "2026-01-02": { distanceMeters: 20000, activities: 1, activityIds: [1] } },
          },
          isLoading: false,
          error: null,
        });

        // Should render without crashing
        expect(() => render(<ActivityCalendarHeatmap />)).not.toThrow();
        expect(screen.getByText("Activity Calendar")).toBeInTheDocument();
      });

      it("Visible button tooltip shows empty list when no visible sports", () => {
        mockUseSportConfig.mockReturnValue(
          mockSportConfigReturn({ sportConfig: mockMinimalSportConfig })
        );
        mockUseVisibleSports.mockReturnValue(mockVisibleSportsReturn({ visibleSports: [] }));
        mockUseDailySportData.mockReturnValue(
          mockDailySportDataReturn({ data: emptyDailySportData })
        );

        render(<ActivityCalendarHeatmap />);

        const visibleButton = screen.getByRole("button", { name: "Visible" });
        expect(visibleButton).toHaveAttribute("title", "Show only: ");
      });
    });

    describe("stale preferences handling", () => {
      it("filters visible sports to only those in config", () => {
        mockUseSportConfig.mockReturnValue(
          mockSportConfigReturn({ sportConfig: mockMinimalSportConfig })
        );
        // User has "deleted_sport" in preferences but it's not in config
        mockUseVisibleSports.mockReturnValue(
          mockVisibleSportsReturn({ visibleSports: ["cycling", "deleted_sport", "yoga"] })
        );
        mockUseDailySportData.mockReturnValue({
          data: {
            cycling: { "2026-01-02": { distanceMeters: 20000, activities: 1, activityIds: [1] } },
            yoga: { "2026-01-02": { timeMinutes: 30, activities: 1, activityIds: [2] } },
          },
          isLoading: false,
          error: null,
        });

        render(<ActivityCalendarHeatmap />);

        // Visible button tooltip should only show valid sports
        const visibleButton = screen.getByRole("button", { name: "Visible" });
        expect(visibleButton).toHaveAttribute("title", "Show only: cycling, yoga");
      });
    });
  });

  describe("malformed wire data", () => {
    // protojson omits proto3 defaults unless EmitUnpopulated is set, so a
    // DailyActivity whose `activities` is 0 can arrive with the field absent.
    // Before the `?? 0` guard, that `undefined` poisoned the day's count to NaN,
    // which propagated through totalActivities into a literal "NaN activities"
    // header. SportBucketSchema doesn't descend into DailyActivity, so the dev
    // contract-drift warning doesn't fire either.
    it("treats a missing `activities` field as zero instead of rendering NaN", () => {
      const poisoned = {
        cycling: {
          "2026-01-02": {
            distanceMeters: 45000,
            timeMinutes: 90,
            elevationMeters: 500,
            // `activities` deliberately absent — the wire shape under test.
            activityIds: [1],
          },
          "2026-01-03": {
            distanceMeters: 30000,
            timeMinutes: 60,
            elevationMeters: 300,
            activities: 2,
            activityIds: [2],
          },
        },
        running: {},
        yoga: {},
      } as unknown as MultiSportData;

      mockUseDailySportData.mockReturnValue(mockDailySportDataReturn({ data: poisoned }));

      const { container } = render(<ActivityCalendarHeatmap />);

      expect(container.textContent).not.toContain("NaN");
      // The one well-formed day still counts; the absent field contributes 0.
      expect(screen.getByText(/2 activities in/)).toBeInTheDocument();
    });

    // Characterisation, not regression: this passes with or without the `?? 0`
    // guard, because the cell already floors its input with `|| 0` and
    // `NaN || 0` is 0. It pins that invariant so the audit's "paints the
    // brightest colour" claim can't become true if someone drops the `|| 0`.
    it("does not paint a day with a missing count as the busiest colour", () => {
      const poisoned = {
        cycling: {
          "2026-01-02": {
            distanceMeters: 45000,
            timeMinutes: 90,
            elevationMeters: 500,
            activityIds: [1],
          },
        },
        running: {},
        yoga: {},
      } as unknown as MultiSportData;

      mockUseDailySportData.mockReturnValue(mockDailySportDataReturn({ data: poisoned }));

      render(<ActivityCalendarHeatmap />);

      // Cell labels are the accessible surface for the count; a poisoned day
      // must read as 0, not NaN, and so must take the dim bucket.
      const cell = screen.getByRole("img", { name: /^2026-01-02:/ });
      expect(cell).toHaveAttribute("aria-label", "2026-01-02: 0 activities");
      expect(cell).toHaveStyle({ background: "var(--color-slate-light)" });
    });
  });
});
