import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import DistanceHistogramChart from "./DistanceHistogramChart";
import type { MapActivity } from "../../api/map";

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
    ...over,
  };
}

/** Hovers the middle of the chart and waits for its tooltip, which Recharts fills a beat later. */
async function hoverChart(container: HTMLElement) {
  fireEvent.mouseMove(container.querySelector(".recharts-wrapper")!, { clientX: 160, clientY: 80 });
  let tooltip: HTMLElement | null = null;
  await waitFor(() => {
    tooltip = container.querySelector<HTMLElement>(".recharts-tooltip-wrapper");
    expect(tooltip?.textContent).toBeTruthy();
  });
  return tooltip!;
}

describe("DistanceHistogramChart", () => {
  it("renders the histogram for a non-empty set", () => {
    render(
      <DistanceHistogramChart
        activities={[
          act({ activityId: 1, distanceMeters: 5_000 }),
          act({ activityId: 2, distanceMeters: 20_000 }),
        ]}
        distanceUnit="miles"
        onSelectRange={vi.fn()}
      />
    );
    expect(screen.getByText(/^Distance \(mi\)$/)).toBeInTheDocument();
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
  });

  it("shows an empty hint when there are no activities", () => {
    render(<DistanceHistogramChart activities={[]} distanceUnit="miles" onSelectRange={vi.fn()} />);
    expect(screen.getByText(/no activities to summarize/i)).toBeInTheDocument();
  });

  it("provides an sr-only data table as a text alternative to the chart", () => {
    render(
      <DistanceHistogramChart
        activities={[act({ activityId: 1, distanceMeters: 5_000 })]}
        distanceUnit="miles"
        onSelectRange={vi.fn()}
      />
    );
    const table = screen.getByRole("table", { name: /activity count by distance/i });
    expect(within(table).getByText("Activities")).toBeInTheDocument();
  });

  it("names the hovered bin and its count in the tooltip", async () => {
    const { container } = render(
      <DistanceHistogramChart
        activities={[act({ activityId: 1 }), act({ activityId: 2 })]}
        distanceUnit="miles"
        onSelectRange={vi.fn()}
      />
    );
    const tooltip = within(await hoverChart(container));
    expect(tooltip.getByText(/^\d+\+ mi$/)).toBeInTheDocument();
    expect(tooltip.getByText("Count")).toBeInTheDocument();
    expect(tooltip.getByText(/^\d+ activities$/)).toBeInTheDocument();
  });
});
