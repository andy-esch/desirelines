import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CumulativeDistanceChart from "./CumulativeDistanceChart";
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
    const tooltip = await hoverChart(container);
    expect(tooltip.textContent).toMatch(/^May [12], 2026Total(1,000|2,000) mi$/);
  });
});
