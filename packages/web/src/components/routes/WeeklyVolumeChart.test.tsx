import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeeklyVolumeChart from "./WeeklyVolumeChart";
import type { MapActivity } from "../../api/map";

// Recharts' ResponsiveContainer needs layout; give it a fixed size in jsdom.
vi.mock("recharts", async () => {
  const actual = await vi.importActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 320, height: 160 }}>
        {children}
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
