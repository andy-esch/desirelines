import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PacingChartPresenter } from "./PacingChartPresenter";
import { createPacingPresenterProps } from "../../test/fixtures/chartTestHelpers";

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

describe("PacingChartPresenter", () => {
  describe("rendering", () => {
    it("should render without crashing", () => {
      const props = createPacingPresenterProps();
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });

    it("should render the responsive container", () => {
      const props = createPacingPresenterProps();
      render(<PacingChartPresenter {...props} />);
      expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
    });

    it("should render with minimal data", () => {
      const props = createPacingPresenterProps({
        mergedData: [{ date: new Date(2024, 0, 1), actual: 10 }],
        pacingGoals: [],
        currentValues: { actual: 10, goals: [] },
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });

    it("should render with empty data", () => {
      const props = createPacingPresenterProps({
        mergedData: [],
        pacingGoals: [],
        currentValues: { actual: 0, goals: [] },
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });
  });

  describe("props handling", () => {
    it("should accept all required props", () => {
      const props = createPacingPresenterProps();
      const { container } = render(<PacingChartPresenter {...props} />);
      expect(container).toBeTruthy();
    });

    it("should handle sessions mode", () => {
      const props = createPacingPresenterProps({
        isSessionsMode: true,
        unitLabel: "sessions",
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle different years", () => {
      const props = createPacingPresenterProps({
        year: 2025,
        startDate: new Date(Date.UTC(2025, 0, 1)),
        displayEndDate: new Date(Date.UTC(2025, 11, 31)),
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });
  });

  describe("danger zone", () => {
    it("should render with danger zone shown", () => {
      const props = createPacingPresenterProps({
        dangerZone: { show: true, threshold: 25, yMax: 33 },
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });

    it("should render with danger zone hidden", () => {
      const props = createPacingPresenterProps({
        dangerZone: { show: false, threshold: 25, yMax: 33 },
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle high threshold values", () => {
      const props = createPacingPresenterProps({
        dangerZone: { show: true, threshold: 100, yMax: 110 },
        naturalYMax: 110,
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle low threshold values", () => {
      const props = createPacingPresenterProps({
        dangerZone: { show: true, threshold: 5, yMax: 10 },
        naturalYMax: 10,
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });
  });

  describe("pacing goals", () => {
    it("should handle multiple pacing goals", () => {
      const props = createPacingPresenterProps({
        pacingGoals: [
          { goal: { id: "1", value: 2000, label: "Min" }, pacing: [] },
          { goal: { id: "2", value: 3000, label: "Target" }, pacing: [] },
          { goal: { id: "3", value: 4000, label: "Stretch" }, pacing: [] },
          { goal: { id: "4", value: 5000, label: "Epic" }, pacing: [] },
        ],
        currentValues: {
          actual: 8.5,
          goals: [
            { label: "Min", value: 5.5, color: "#00ffff" },
            { label: "Target", value: 8.2, color: "#00ff80" },
            { label: "Stretch", value: 11.0, color: "#ff00ff" },
            { label: "Epic", value: 13.7, color: "#ffc800" },
          ],
        },
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle zero pacing goals", () => {
      const props = createPacingPresenterProps({
        pacingGoals: [],
        currentValues: { actual: 10, goals: [] },
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });
  });

  describe("units", () => {
    it("should handle miles unit", () => {
      const props = createPacingPresenterProps({ unitLabel: "mi" });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle kilometers unit", () => {
      const props = createPacingPresenterProps({ unitLabel: "km" });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });

    it("should handle sessions unit", () => {
      const props = createPacingPresenterProps({
        unitLabel: "sessions",
        isSessionsMode: true,
      });
      expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
    });
  });

  describe("Y-axis max", () => {
    it("should handle various naturalYMax values", () => {
      const testValues = [10, 33, 50, 100, 250];
      testValues.forEach((naturalYMax) => {
        const props = createPacingPresenterProps({
          naturalYMax,
          dangerZone: { show: true, threshold: naturalYMax * 0.75, yMax: naturalYMax },
        });
        expect(() => render(<PacingChartPresenter {...props} />)).not.toThrow();
      });
    });
  });
});
