import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartTooltip } from "./ChartTooltip";

describe("ChartTooltip", () => {
  const mockPayload = [
    {
      name: "Actual",
      value: 2450,
      stroke: "#4285f4",
      color: "#4285f4",
    },
    {
      name: "Goal Line",
      value: 2800,
      stroke: "#34a853",
      color: "#34a853",
    },
  ];

  it("renders nothing when inactive", () => {
    const { container } = render(
      <ChartTooltip active={false} payload={mockPayload} label="2025-10-22" />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when payload is empty", () => {
    const { container } = render(<ChartTooltip active={true} payload={[]} label="2025-10-22" />);

    expect(container.firstChild).toBeNull();
  });

  it("renders date and values when active", () => {
    render(
      <ChartTooltip active={true} payload={mockPayload} label="2025-10-22" unit="mi" decimals={1} />
    );

    // Check data entries render correctly (labels without colon, values without unit)
    expect(screen.getByText("Actual")).toBeInTheDocument();
    expect(screen.getByText("2450.0")).toBeInTheDocument();

    expect(screen.getByText("Goal Line")).toBeInTheDocument();
    expect(screen.getByText("2800.0")).toBeInTheDocument();
  });

  it("titles a point with its date, as the chart's hooks hand it over", () => {
    render(
      <ChartTooltip active={true} payload={mockPayload} label={new Date(Date.UTC(2026, 5, 22))} />
    );

    expect(screen.getByText("Jun 22")).toBeInTheDocument();
    expect(screen.queryByText(/GMT/)).not.toBeInTheDocument();
  });

  it("names prior years in the label color, not their faded lines'", () => {
    render(
      <ChartTooltip
        active={true}
        payload={[
          { name: "Actual", value: 1500, dataKey: "actual" },
          { name: "Target 4,000", value: 1800, dataKey: "goal0" },
          {
            name: "2021",
            value: 1200,
            dataKey: "prior_2021",
            stroke: "color-mix(in srgb, var(--color-chart-neutral) 9%, transparent)",
          },
        ]}
        label={Date.UTC(2026, 5, 22)}
        compact
      />
    );

    expect(screen.getByText("2021")).toHaveStyle({ color: "var(--color-chart-tooltip-label)" });
  });

  describe("telling the lines apart", () => {
    /** The compact tooltip's line: the year's value and how far it is from the next goal. */
    const delta = () => screen.getByText(/ vs /).textContent;

    it("knows a goal by its data key, whatever the goal is called", () => {
      render(
        <ChartTooltip
          active={true}
          payload={[
            { name: "Data 2026 1,800", value: 1800, dataKey: "goal0" },
            { name: "Actual", value: 1500, dataKey: "actual" },
            { name: "Average · est 3,101", value: 1600, dataKey: "average" },
          ]}
          label="2025-10-22"
          compact
          goalLabels={["Data 2026"]}
        />
      );

      expect(screen.getByText("1500.0 mi")).toBeInTheDocument();
      expect(delta()).toBe("−300.0 vs Data 2026");
    });

    it("measures against a goal called Average, not the average line", () => {
      render(
        <ChartTooltip
          active={true}
          payload={[
            { name: "Actual", value: 1500, dataKey: "actual" },
            { name: "Average pace 2,000", value: 2000, dataKey: "goal0" },
            { name: "Average · est 3,101", value: 1600, dataKey: "average" },
          ]}
          label="2025-10-22"
          compact
          goalLabels={["Average pace"]}
        />
      );

      expect(delta()).toBe("−500.0 vs Average pace");
    });

    it("never takes the max-pace line for a goal", () => {
      render(
        <ChartTooltip
          active={true}
          payload={[
            { name: "Max at 20 mi/day", value: 1700, dataKey: "dangerBoundary" },
            { name: "Actual", value: 1500, dataKey: "actual" },
            { name: "Target 4,000", value: 1800, dataKey: "goal0" },
          ]}
          label="2025-10-22"
          compact
          goalLabels={["Target"]}
        />
      );

      expect(delta()).toBe("−300.0 vs Target");
    });

    it("stays compact without goals, showing the year's value and no delta", () => {
      render(
        <ChartTooltip
          active={true}
          payload={[
            { name: "Actual", value: 1500, dataKey: "actual" },
            { name: "Average · est 3,101", value: 1600, dataKey: "average" },
          ]}
          label="2025-10-22"
          compact
        />
      );

      expect(screen.getByText("1500.0 mi")).toBeInTheDocument();
      expect(screen.queryByText(/ vs /)).not.toBeInTheDocument();
      expect(screen.queryByText("Average · est 3,101")).not.toBeInTheDocument();
    });

    it("measures against the last goal once the year has passed them all", () => {
      render(
        <ChartTooltip
          active={true}
          payload={[
            { name: "Actual", value: 2500, dataKey: "actual" },
            { name: "Base 1,000", value: 1000, dataKey: "goal0" },
            { name: "Stretch 2,000", value: 2000, dataKey: "goal1" },
          ]}
          label="2025-10-22"
          compact
          goalLabels={["Base", "Stretch"]}
        />
      );

      expect(delta()).toBe("+500.0 vs Stretch");
    });
  });

  it("shows a missing value for the actual line on a date it hasn't reached", () => {
    render(
      <ChartTooltip
        active={true}
        payload={[{ name: "Target 4,000", value: 2800, dataKey: "goal0" }]}
        label="2025-10-22"
        compact
      />
    );

    expect(screen.getByText("—").parentElement?.className).toContain("--missing-value-color");
  });

  it("formats values with specified decimals", () => {
    render(
      <ChartTooltip
        active={true}
        payload={[{ name: "Pace", value: 8.25 }]}
        label="2025-10-22"
        unit="mi/day"
        decimals={2}
      />
    );

    expect(screen.getByText("8.25")).toBeInTheDocument();
  });

  it("respects decimal places", () => {
    render(
      <ChartTooltip
        active={true}
        payload={[{ name: "Distance", value: 2450.567 }]}
        label="2025-10-22"
        unit="mi"
        decimals={2}
      />
    );

    expect(screen.getByText("2450.57")).toBeInTheDocument();
  });

  it("handles string values", () => {
    render(
      <ChartTooltip
        active={true}
        payload={[{ name: "Status", value: "Active" }]}
        label="2025-10-22"
        unit=""
      />
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("uses default decimals (1) when not provided", () => {
    render(
      <ChartTooltip active={true} payload={[{ name: "Test", value: 123.456 }]} label="2025-10-22" />
    );

    expect(screen.getByText("123.5")).toBeInTheDocument();
  });

  it("uses fallback color when stroke/color not provided", () => {
    render(
      <ChartTooltip active={true} payload={[{ name: "Test", value: 100 }]} label="2025-10-22" />
    );

    // Check that the tooltip renders with data (labels without colon)
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("100.0")).toBeInTheDocument();
  });
});
