import { cloneElement, type ReactElement } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeeklyVolumeChart from "./WeeklyVolumeChart";
import type { MapActivity } from "../../api/map";
import { hoverChart } from "../../test/fixtures/chartTestHelpers";

// Recharts' ResponsiveContainer needs layout; give it a fixed size in jsdom.
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
    startDateLocal: "2026-05-04T08:00:00",
    regionIds: [],
    ...over,
  };
}

/** Hovers the middle of the 320×160 chart and returns its tooltip. */
const hover = (container: HTMLElement) => hoverChart(container, { x: 160, y: 80 });

describe("WeeklyVolumeChart", () => {
  it("renders the chart with a distance/time toggle", () => {
    render(<WeeklyVolumeChart activities={[act()]} distanceUnit="miles" />);
    expect(screen.getByText("Weekly volume")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Distance" })).toBeInTheDocument();
    expect(screen.getByTestId("responsive-container")).toBeInTheDocument();
  });

  it("switches metric without crashing", async () => {
    const user = userEvent.setup();
    render(<WeeklyVolumeChart activities={[act()]} distanceUnit="miles" />);
    await user.click(screen.getByRole("button", { name: "Time" }));
    expect(screen.getByRole("button", { name: "Time" })).toHaveAttribute("aria-pressed", "true");
  });

  it("titles the hovered week and shows its volume in the tooltip", async () => {
    const user = userEvent.setup();
    const { container } = render(<WeeklyVolumeChart activities={[act()]} distanceUnit="miles" />);
    const distance = within(await hover(container));
    expect(distance.getByText("Week of May 4, 2026")).toBeInTheDocument();
    expect(distance.getByText("Volume")).toBeInTheDocument();
    expect(distance.getByText("6 mi")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Time" }));
    expect(within(await hover(container)).getByText("1 h")).toBeInTheDocument();
  });

  it("shows an empty hint when there are no activities", () => {
    render(<WeeklyVolumeChart activities={[]} distanceUnit="miles" />);
    expect(screen.getByText(/no activities to summarize/i)).toBeInTheDocument();
  });

  it("provides an sr-only data table as a text alternative to the chart", () => {
    render(<WeeklyVolumeChart activities={[act()]} distanceUnit="miles" />);
    const table = screen.getByRole("table", { name: /weekly distance by week/i });
    expect(within(table).getByText("Week of")).toBeInTheDocument();
  });
});
