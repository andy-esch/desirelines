import { cloneElement, type ReactElement } from "react";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ActivityVolumeChart, { topOfStack } from "./ActivityVolumeChart";
import type { ChartData } from "../../utils/activityBuckets";

// Hand the chart the size the container would measure; without one Recharts draws nothing.
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => <div>{cloneElement(children, { width: 320, height: 200 })}</div>,
  };
});

// Stacking order: the first series sits at the bottom of each month's bar.
const series: ChartData["series"] = [
  { key: "Ride", sport: "Ride" },
  { key: "Run", sport: "Run" },
  { key: "Swim", sport: "Swim" },
];

describe("topOfStack", () => {
  it("is the last series in stacking order", () => {
    expect(topOfStack({ month: "2026-05", Ride: 10, Run: 4, Swim: 2 }, series)).toBe("Swim");
  });

  it("skips series with no volume that month, so the visible top gets the corners", () => {
    expect(topOfStack({ month: "2026-05", Ride: 10, Run: 4, Swim: 0 }, series)).toBe("Run");
  });

  it("is nothing for an empty month", () => {
    expect(topOfStack({ month: "2026-05", Ride: 0, Run: 0, Swim: 0 }, series)).toBeUndefined();
  });
});

describe("the volume tooltip", () => {
  const data: ChartData = {
    rows: [{ month: "2026-08", cycling: 25, running: 6, yoga: 0 }],
    series: [
      { key: "cycling", sport: "cycling" },
      { key: "running", sport: "running" },
      { key: "yoga", sport: "yoga" },
    ],
  };

  it("titles the hovered month, lists its sports top of the stack first, and totals them", async () => {
    const { container } = render(
      <ActivityVolumeChart
        data={data}
        sportConfig={null}
        formatAxisValue={String}
        formatTooltipValue={(value) => `${value}h`}
        metricLabel="Time (h)"
        allowDecimals
      />
    );
    fireEvent.mouseMove(container.querySelector(".recharts-wrapper")!, {
      clientX: 160,
      clientY: 100,
    });
    let tooltip: HTMLElement | null = null;
    await waitFor(() => {
      tooltip = container.querySelector<HTMLElement>(".recharts-tooltip-wrapper");
      expect(tooltip?.textContent).toBeTruthy();
    });

    const rows = within(tooltip!);
    expect(rows.getByText("Aug '26")).toBeInTheDocument();
    // A sport with no time that month gets no row.
    expect(tooltip!.textContent).toBe("Aug '26Running6hCycling25hTotal31h");
    expect(rows.queryByText("Yoga")).not.toBeInTheDocument();
  });
});
