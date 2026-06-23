import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RegionBreakdownChart, { type RegionBreakdownChartProps } from "./RegionBreakdownChart";
import type { MapActivity } from "../../api/map";

function act(over: Partial<MapActivity> = {}): MapActivity {
  return {
    activityId: 1,
    name: "x",
    sport: "cycling",
    distanceMeters: 10_000,
    movingTime: 3_600,
    elevationMeters: 0,
    startDateLocal: "2026-05-01T08:00:00",
    regionIds: [10],
    ...over,
  };
}

function renderChart(over: Partial<RegionBreakdownChartProps> = {}) {
  const onSelectRegion = vi.fn();
  const props: RegionBreakdownChartProps = {
    activities: [
      act({ activityId: 1, regionIds: [10], distanceMeters: 30_000 }),
      act({ activityId: 2, regionIds: [20], distanceMeters: 10_000 }),
    ],
    regionNames: { 10: "New York", 20: "Boston" },
    distanceUnit: "miles",
    selectedRegionId: null,
    onSelectRegion,
    ...over,
  };
  render(<RegionBreakdownChart {...props} />);
  return { onSelectRegion };
}

describe("RegionBreakdownChart", () => {
  it("renders a bar per region using its name", () => {
    renderChart();
    expect(screen.getByText("New York")).toBeInTheDocument();
    expect(screen.getByText("Boston")).toBeInTheDocument();
  });

  it("clicking a region filters to it", async () => {
    const user = userEvent.setup();
    const { onSelectRegion } = renderChart();
    await user.click(screen.getByRole("button", { name: /new york/i }));
    expect(onSelectRegion).toHaveBeenCalledWith(10);
  });

  it("clicking the already-selected region clears it (toggle off)", async () => {
    const user = userEvent.setup();
    const { onSelectRegion } = renderChart({ selectedRegionId: 10 });
    await user.click(screen.getByRole("button", { name: /new york/i }));
    expect(onSelectRegion).toHaveBeenCalledWith(null);
  });

  it("shows an empty hint when no region data", () => {
    renderChart({ activities: [act({ regionIds: [] })] });
    expect(screen.getByText(/no region data/i)).toBeInTheDocument();
  });
});
