import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ActivityCalendarHeatmap from "./ActivityCalendarHeatmap";

// Mock useDailySportData hook
vi.mock("../../hooks/useDailySportData", () => ({
  useDailySportData: vi.fn(),
}));

import { useDailySportData } from "../../hooks/useDailySportData";

const mockUseDailySportData = vi.mocked(useDailySportData);

describe("ActivityCalendarHeatmap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loading state", () => {
    it("shows loading spinner when data is loading", () => {
      mockUseDailySportData.mockReturnValue({
        data: { cycling: {}, running: {}, yoga: {} },
        isLoading: true,
        error: null,
      });

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });

    it("shows Activity Calendar header while loading", () => {
      mockUseDailySportData.mockReturnValue({
        data: { cycling: {}, running: {}, yoga: {} },
        isLoading: true,
        error: null,
      });

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByText("Activity Calendar")).toBeInTheDocument();
    });
  });

  describe("error state", () => {
    it("shows error message when data fails to load", () => {
      mockUseDailySportData.mockReturnValue({
        data: { cycling: {}, running: {}, yoga: {} },
        isLoading: false,
        error: new Error("Failed to fetch"),
      });

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
            "2026-01-02": { distanceMeters: 20000, timeMinutes: 60, activities: 1, activityIds: [1] },
            "2026-01-03": { distanceMeters: 50000, timeMinutes: 120, activities: 2, activityIds: [2, 3] },
          },
          running: {
            "2026-01-02": { distanceMeters: 5000, timeMinutes: 30, activities: 1, activityIds: [4] },
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
      mockUseDailySportData.mockReturnValue({
        data: { cycling: {}, running: {}, yoga: {} },
        isLoading: false,
        error: null,
      });

      render(<ActivityCalendarHeatmap />);

      expect(screen.getByText("Activity Calendar")).toBeInTheDocument();
      expect(screen.getByText(/0 activities in past 12 months/)).toBeInTheDocument();
    });
  });

  describe("className prop", () => {
    it("applies custom className", () => {
      mockUseDailySportData.mockReturnValue({
        data: { cycling: {}, running: {}, yoga: {} },
        isLoading: false,
        error: null,
      });

      const { container } = render(<ActivityCalendarHeatmap className="custom-class" />);

      expect(container.querySelector(".custom-class")).toBeInTheDocument();
    });
  });
});
