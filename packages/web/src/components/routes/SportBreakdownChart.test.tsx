import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SportBreakdownChart, { type SportBreakdownChartProps } from "./SportBreakdownChart";
import type { MapActivity } from "../../api/map";

function act(over: Partial<MapActivity> = {}): MapActivity {
  return {
    activityId: 1,
    name: "x",
    sport: "cycling",
    distanceMeters: 30_000,
    movingTime: 3_600,
    elevationMeters: 100,
    startDateLocal: "2026-05-01T08:00:00",
    regionIds: [],
    ...over,
  };
}

function renderChart(over: Partial<SportBreakdownChartProps> = {}) {
  const onToggleSport = vi.fn();
  const props: SportBreakdownChartProps = {
    activities: [
      act({ activityId: 1, sport: "cycling", distanceMeters: 30_000 }),
      act({ activityId: 2, sport: "running", distanceMeters: 10_000 }),
    ],
    sportColors: { cycling: "rgb(0,255,255)", running: "rgb(255,0,255)" },
    sportLabels: { cycling: "Cycling", running: "Running" },
    distanceUnit: "miles",
    selectedSports: [],
    onToggleSport,
    ...over,
  };
  render(<SportBreakdownChart {...props} />);
  return { onToggleSport };
}

describe("SportBreakdownChart", () => {
  it("renders a bar per sport with its label", () => {
    renderChart();
    expect(screen.getByText("Cycling")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("clicking a sport bar toggles it in the cross-filter", async () => {
    const user = userEvent.setup();
    const { onToggleSport } = renderChart();
    await user.click(screen.getByRole("button", { name: /cycling/i }));
    expect(onToggleSport).toHaveBeenCalledWith("cycling");
  });

  it("switches the metric (distance → count)", async () => {
    const user = userEvent.setup();
    renderChart();
    // Distance default: 30,000 m ≈ 18.6 mi for cycling.
    expect(screen.getByText(/18\.6 mi/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Count" }));
    // Count metric: cycling shows "1".
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("marks selected sports pressed", () => {
    renderChart({ selectedSports: ["running"] });
    expect(screen.getByRole("button", { name: /running/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("shows an empty hint when there are no activities", () => {
    renderChart({ activities: [] });
    expect(screen.getByText(/no activities to summarize/i)).toBeInTheDocument();
  });
});
