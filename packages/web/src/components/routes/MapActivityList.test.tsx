import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapActivityList, { type MapActivityListProps } from "./MapActivityList";
import type { MapActivity } from "../../api/map";

function act_(over: Partial<MapActivity> = {}): MapActivity {
  return {
    activityId: 1,
    name: "Morning Ride",
    sport: "cycling",
    distanceMeters: 30_000,
    movingTime: 3_600,
    elevationMeters: 200,
    startDateLocal: "2026-05-01T08:00:00",
    regionIds: [10],
    ...over,
  };
}

function renderList(over: Partial<MapActivityListProps> = {}) {
  const onSelect = vi.fn();
  const props: MapActivityListProps = {
    activities: [
      act_({ activityId: 1, name: "Morning Ride" }),
      act_({ activityId: 2, name: "Evening Run", sport: "running" }),
    ],
    sportColors: { cycling: "rgb(0,255,255)", running: "rgb(255,0,255)" },
    distanceUnit: "miles",
    selectedId: null,
    onSelect,
    ...over,
  };
  render(<MapActivityList {...props} />);
  return { onSelect };
}

describe("MapActivityList", () => {
  it("renders a row per activity with its name + count header", () => {
    renderList();
    expect(screen.getByText("Activities (2)")).toBeInTheDocument();
    expect(screen.getByText("Morning Ride")).toBeInTheDocument();
    expect(screen.getByText("Evening Run")).toBeInTheDocument();
  });

  it("renders nothing when there are no activities", () => {
    const { container } = render(
      <MapActivityList
        activities={[]}
        sportColors={{}}
        distanceUnit="miles"
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("selects an activity when its row is clicked", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderList();
    await user.click(screen.getByText("Evening Run"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ activityId: 2, name: "Evening Run" });
  });

  it("marks the selected row pressed", () => {
    renderList({ selectedId: 2 });
    const rows = screen.getAllByRole("button");
    const pressed = rows.filter((r) => r.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
  });

  it("pages the list at 5 per page with prev/next", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 20 }, (_, i) =>
      act_({ activityId: i + 1, name: `Activity ${i + 1}` })
    );
    renderList({ activities: many });
    // First page: 5 shown, "1–5 of 20".
    expect(screen.getByText(/1–5 of 20/)).toBeInTheDocument();
    expect(screen.getByText("Activity 1")).toBeInTheDocument();
    expect(screen.queryByText("Activity 6")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(screen.getByText(/6–10 of 20/)).toBeInTheDocument();
    expect(screen.getByText("Activity 6")).toBeInTheDocument();
    expect(screen.queryByText("Activity 1")).not.toBeInTheDocument();
  });

  it("collapses and expands the list", async () => {
    const user = userEvent.setup();
    renderList();
    expect(screen.getByText("Morning Ride")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /activities \(2\)/i }));
    expect(screen.queryByText("Morning Ride")).not.toBeInTheDocument();
  });

  it("has a Strava link per row that does NOT trigger row selection", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderList();
    const links = screen.getAllByRole("link", { name: /view on strava/i });
    expect(links[0]).toHaveAttribute("href", "https://www.strava.com/activities/1");
    await user.click(links[0]!);
    expect(onSelect).not.toHaveBeenCalled(); // stopPropagation — link opens Strava, not select
  });
});
