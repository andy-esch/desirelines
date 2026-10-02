import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, fireEvent } from "@testing-library/react";
import RecentActivitiesList from "./RecentActivitiesList";
import { THEMES } from "../../themes/registry";
import { ThemeStructureProvider } from "../theme/ThemeStructureProvider";
import type { UseActivitiesResult } from "../../hooks/useActivities";
import type { ActivitySummary } from "../../api/activities";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../../hooks/useDashboardGoalData", () => ({
  useDashboardGoalData: vi.fn(() => ({ sportData: [], distanceUnit: "kilometers" })),
}));
// The pagination cases step through the arrow pager: Miami, with Arcade's pager.
vi.mock("../../contexts/ThemeContext", async () => {
  const { getTheme } = await import("../../themes/registry");
  const miami = getTheme("miami");
  return {
    useTheme: () => ({
      theme: { ...miami, structure: { ...miami.structure, pagerStyle: "arrows" } },
    }),
  };
});
vi.mock("../../hooks/useActivities", () => ({ useActivities: vi.fn() }));
vi.mock("../../hooks/useSportConfig", () => ({ useSportConfig: () => ({ sportConfig: null }) }));

import { useActivities } from "../../hooks/useActivities";
import { useDashboardGoalData, type SportGoalData } from "../../hooks/useDashboardGoalData";
import { createYearContext } from "../../utils/yearContext";
const mockUseActivities = vi.mocked(useActivities);

function activity(id: number): ActivitySummary {
  return {
    id: String(id),
    name: `Activity ${id}`,
    type: "Ride",
    sport: "cycling",
    startDateLocal: "2026-01-0" + ((id % 9) + 1) + "T08:00:00",
    distanceMeters: 1000 * id,
    movingTimeSeconds: 600,
    elevationMeters: 10,
    hasRoute: false,
  };
}

describe("RecentActivitiesList missing values", () => {
  it("marks an activity's missing distance and goal share", () => {
    mockUseActivities.mockReturnValue({
      activities: [{ ...activity(1), distanceMeters: 0 }],
      isLoading: false,
      error: null,
      hasMore: false,
      isLoadingMore: false,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });

    render(<RecentActivitiesList timeRange="4weeks" pageSize={5} />);

    // No distance, and no goal to take a share of, so both cells are missing values.
    const dashes = screen.getAllByText("—");
    expect(dashes).toHaveLength(2);
    for (const dash of dashes) {
      expect(dash.parentElement?.className).toContain("--missing-value-color");
    }
  });
});

describe("RecentActivitiesList Impact column", () => {
  const cyclingGoal = (hasGoal: boolean): SportGoalData => ({
    sport: "cycling",
    displayName: "Cycling",
    color: "#000",
    currentValue: 100,
    hasGoal,
    targetGoal: hasGoal ? 2000 : 0,
    metricUnit: "km",
    metricType: "distance",
    impactGoal: hasGoal ? 1000 : 0,
    impactGoalLabel: hasGoal ? "Base" : "",
  });

  function renderWithGoal(goal: SportGoalData, isLoading = false) {
    vi.mocked(useDashboardGoalData).mockReturnValue({
      sportData: [goal],
      yearContext: createYearContext(2026),
      distanceUnit: "kilometers",
      isLoading,
      error: null,
      retry: vi.fn(),
    });
    mockUseActivities.mockReturnValue({
      activities: [activity(5)],
      isLoading: false,
      error: null,
      hasMore: false,
      isLoadingMore: false,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    render(<RecentActivitiesList timeRange="4weeks" pageSize={5} />);
  }

  afterEach(() => vi.mocked(useDashboardGoalData).mockReset());

  it("shows an activity's share of the sport's smallest goal", () => {
    renderWithGoal(cyclingGoal(true));
    // 5 km of a 1,000 km goal.
    expect(screen.getByTitle("vs. 1,000 km Base goal")).toHaveTextContent("0.5%");
  });

  it("says where to set a goal for a sport without one, instead of a share", () => {
    renderWithGoal(cyclingGoal(false));
    const cell = screen.getByTitle(
      "No Cycling goal. Set one on the Cycling page to see each activity's share."
    );
    expect(cell).toHaveTextContent("none");
  });

  it("says nothing about a missing goal while the goals load", () => {
    renderWithGoal(cyclingGoal(false), true);
    expect(screen.queryByTitle(/No Cycling goal/)).toBeNull();
  });
});

describe("RecentActivitiesList pagination", () => {
  beforeEach(() => vi.clearAllMocks());

  // Regression: at the last *local* page with hasMore, handleNextPage calls the
  // async loadMore() and optimistically does setPage(p + 1). On the re-render that
  // setPage triggers, the fetch has not resolved, so activities.length — and thus
  // totalPages — is unchanged, and the clamp
  //   clampedPage = Math.min(page, totalPages - 1)
  // snapped page straight back. The user's first "Older" click at each server-page
  // boundary was a no-op and a second click was required. It only reproduced when
  // the next page wasn't already cached, i.e. the common case, which is why it
  // survived. The clamp is now skipped while isLoadingMore is true.
  it("advances on the first Older click at a server-page boundary", () => {
    const firstPage = [activity(1), activity(2)];
    let isLoadingMore = false;

    mockUseActivities.mockImplementation((): UseActivitiesResult => ({
      activities: firstPage,
      isLoading: false,
      error: null,
      hasMore: true,
      isLoadingMore,
      // Mirrors fetchNextPage: the flag flips now, the data lands later.
      loadMore: () => {
        isLoadingMore = true;
      },
      retry: vi.fn(),
    }));

    render(<RecentActivitiesList timeRange="4weeks" pageSize={2} />);

    // pageSize 2 with 2 activities => one local page, so page 0 is the boundary.
    expect(screen.getByText("1/+")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Older activities"));

    // Before the fix this read "1/+" again — the click was swallowed.
    expect(screen.getByText("2/+")).toBeInTheDocument();
  });

  it("still clamps an out-of-range page when nothing is being fetched", () => {
    // The clamp's original purpose: a resize shrinks pageSize-derived totalPages
    // and the current page falls out of range. With no fetch in flight it must
    // still pull the page back rather than render an empty slice.
    mockUseActivities.mockImplementation((): UseActivitiesResult => ({
      activities: [activity(1)],
      isLoading: false,
      error: null,
      hasMore: true,
      isLoadingMore: false,
      loadMore: vi.fn(),
      retry: vi.fn(),
    }));

    const { rerender } = render(<RecentActivitiesList timeRange="4weeks" pageSize={1} />);
    fireEvent.click(screen.getByLabelText("Older activities"));

    // hasMore is true but loadMore never resolves and isLoadingMore stays false,
    // so the advance is not protected and the clamp reels it back in.
    rerender(<RecentActivitiesList timeRange="4weeks" pageSize={1} />);
    expect(screen.getByText("1/+")).toBeInTheDocument();
  });

  it("pages with a labelled row where the theme asks for one", () => {
    mockUseActivities.mockReturnValue({
      activities: [activity(1), activity(2), activity(3)],
      isLoading: false,
      error: null,
      hasMore: true,
      isLoadingMore: false,
      loadMore: vi.fn(),
      retry: vi.fn(),
    });
    const structure = { ...THEMES[0].structure, pagerStyle: "labelled" as const };

    render(
      <ThemeStructureProvider structure={structure}>
        <RecentActivitiesList timeRange="2weeks" pageSize={5} />
      </ThemeStructureProvider>
    );

    expect(screen.getByRole("button", { name: "Older activities" })).toHaveTextContent("Next");
    expect(screen.getByRole("button", { name: "Newer activities" })).toBeDisabled();
  });
});

describe("RecentActivitiesList error", () => {
  it("names the failure and retries the request", async () => {
    const retry = vi.fn();
    mockUseActivities.mockReturnValue({
      activities: [],
      isLoading: false,
      error: new Error("Network request failed"),
      hasMore: false,
      isLoadingMore: false,
      loadMore: vi.fn(),
      retry,
    });

    const { container } = render(<RecentActivitiesList timeRange="4weeks" pageSize={5} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Error loading activities.*Network request failed/
    );
    // The list draws its own panel, so the error takes the danger frame.
    expect(container.querySelector("section")?.className).toContain("--error-frame-color");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
