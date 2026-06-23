import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CumulativeDistanceChart from "./CumulativeDistanceChart";
import type { MapActivity } from "../../api/map";

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
    startDateLocal: "2026-05-01T08:00:00",
    regionIds: [],
    ...over,
  };
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
});
