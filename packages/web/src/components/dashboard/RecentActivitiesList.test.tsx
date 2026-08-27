import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import RecentActivitiesList from "./RecentActivitiesList";
import type { UseActivitiesResult } from "../../hooks/useActivities";
import type { ActivitySummary } from "../../api/activities";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../hooks/useAuth", () => ({ useAuth: () => ({ user: { uid: "u1" } }) }));
vi.mock("../../hooks/useDashboardGoalData", () => ({
  useDashboardGoalData: () => ({ sportData: [], distanceUnit: "kilometers" }),
}));
vi.mock("../../contexts/ThemeContext", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("../../hooks/useActivities", () => ({ useActivities: vi.fn() }));

import { useActivities } from "../../hooks/useActivities";
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
});
