import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CumulativeChartPresenter } from "./CumulativeChartPresenter";
import {
  createCumulativePresenterProps,
  sampleAchievements,
} from "../../test/fixtures/chartTestHelpers";

// Mock ResizeObserver which Recharts uses
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 800, height: 400 }}>
        {children}
      </div>
    ),
  };
});

describe("CumulativeChartPresenter", () => {
  describe("rendering", () => {
    it("should render without crashing", () => {
      const props = createCumulativePresenterProps();
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });

    it("should render the responsive container", () => {
      const props = createCumulativePresenterProps();
      render(<CumulativeChartPresenter {...props} />);
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });

    it("should render with minimal data", () => {
      const props = createCumulativePresenterProps({
        mergedData: [{ date: new Date(2024, 0, 1), actual: 10 }],
        goalLines: [],
        currentValues: { actual: 10, goals: [] },
      });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });

    it("should render with empty data", () => {
      const props = createCumulativePresenterProps({
        mergedData: [],
        goalLines: [],
        goalAchievements: [],
        currentValues: { actual: 0, goals: [] },
      });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });
  });

  describe("props handling", () => {
    it("should accept all required props", () => {
      const props = createCumulativePresenterProps();
      const { container } = render(<CumulativeChartPresenter {...props} />);
      expect(container).toBeTruthy();
    });

    it("should handle sessions mode", () => {
      const props = createCumulativePresenterProps({
        isSessionsMode: true,
        unitLabel: "sessions",
      });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle different years", () => {
      const props = createCumulativePresenterProps({
        year: 2025,
        startDate: new Date(Date.UTC(2025, 0, 1)),
        displayEndDate: new Date(Date.UTC(2025, 11, 31)),
      });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });
  });

  describe("achievements", () => {
    it("should render with achievements when showAchievements is true", () => {
      const props = createCumulativePresenterProps({
        goalAchievements: sampleAchievements.multiple(2024),
        showAchievements: true,
      });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });

    it("should render without achievements when showAchievements is false", () => {
      const props = createCumulativePresenterProps({
        goalAchievements: sampleAchievements.multiple(2024),
        showAchievements: false,
      });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });

    it("should render achievement legend when achievements exist", () => {
      const props = createCumulativePresenterProps({
        goalAchievements: sampleAchievements.single(2024),
        showAchievements: true,
      });
      render(<CumulativeChartPresenter {...props} />);
      expect(screen.getByText("Goals Achieved")).toBeInTheDocument();
    });

    it("should not render achievement legend when showAchievements is false", () => {
      const props = createCumulativePresenterProps({
        goalAchievements: sampleAchievements.single(2024),
        showAchievements: false,
      });
      render(<CumulativeChartPresenter {...props} />);
      expect(screen.queryByText("Goals Achieved")).not.toBeInTheDocument();
    });
  });

  describe("goals", () => {
    it("should handle multiple goals", () => {
      const props = createCumulativePresenterProps({
        goalLines: [
          { goal: { id: "1", value: 2000, label: "Min" }, line: [] },
          { goal: { id: "2", value: 3000, label: "Target" }, line: [] },
          { goal: { id: "3", value: 4000, label: "Stretch" }, line: [] },
          { goal: { id: "4", value: 5000, label: "Epic" }, line: [] },
        ],
        currentValues: {
          actual: 1500,
          goals: [
            { label: "Min", value: 1200, color: "#00ffff" },
            { label: "Target", value: 1800, color: "#00ff80" },
            { label: "Stretch", value: 2400, color: "#ff00ff" },
            { label: "Epic", value: 3000, color: "#ffc800" },
          ],
        },
      });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle zero goals", () => {
      const props = createCumulativePresenterProps({
        goalLines: [],
        currentValues: { actual: 100, goals: [] },
      });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });
  });

  describe("units", () => {
    it("should handle miles unit", () => {
      const props = createCumulativePresenterProps({ unitLabel: "mi" });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle kilometers unit", () => {
      const props = createCumulativePresenterProps({ unitLabel: "km" });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle sessions unit", () => {
      const props = createCumulativePresenterProps({
        unitLabel: "sessions",
        isSessionsMode: true,
      });
      expect(() => render(<CumulativeChartPresenter {...props} />)).not.toThrow();
    });
  });
});
