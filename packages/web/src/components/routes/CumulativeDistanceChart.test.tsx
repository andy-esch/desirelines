import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CumulativeDistanceChart from "./CumulativeDistanceChart";
import type { MapActivity } from "../../api/map";
import { hoverChart } from "../../test/fixtures/chartTestHelpers";

vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    // Hand the chart the size the container would measure; without one Recharts draws nothing.
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => (
      <div data-testid="responsive-container" style={{ width: 320, height: 160 }}>
        {cloneElement(children, { width: 320, height: 160 })}
      </div>
    ),
  };
});

function act(over: Partial<MapActivity> = {}): MapActivity {
  return {
    activityId: 1,
    name: "x",
    sport: "cycling",
    distanceMeters: 10_000,
    movingTime: 3_600,
    elevationMeters: 0,
    startDateLocal: "2026-05-01T08:00:00",
    regionIds: [],
    source: "strava",
    sourceUrl: "https://www.strava.com/activities/1",
    ...over,
  };
}

/** Hovers the middle of the 320×160 chart and returns its tooltip. */
const hover = (container: HTMLElement) => hoverChart(container, { x: 160, y: 80 });

describe("CumulativeDistanceChart", () => {
  it("renders the chart for a non-empty set", () => {
    render(
      <CumulativeDistanceChart
        activities={[
          act({ activityId: 1 }),
          act({ activityId: 2, startDateLocal: "2026-05-02T08:00:00" }),
        ]}
        distanceUnit="miles"
      />
    );
    expect(screen.getByText("Cumulative distance")).toBeInTheDocument();
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
  });

  it("shows an empty hint when there are no activities", () => {
    render(<CumulativeDistanceChart activities={[]} distanceUnit="miles" />);
    expect(screen.getByText(/no activities to summarize/i)).toBeInTheDocument();
  });

  it("dates the hovered day and shows the running total in the tooltip", async () => {
    const { container } = render(
      <CumulativeDistanceChart
        activities={[
          act({ activityId: 1, distanceMeters: 1_609_344 }),
          act({ activityId: 2, startDateLocal: "2026-05-02T08:00:00", distanceMeters: 1_609_344 }),
        ]}
        distanceUnit="miles"
      />
    );
    const tooltip = await hover(container);
    expect(tooltip.textContent).toMatch(/^May [12], 2026Total(1,000|2,000) mi$/);
  });
});
