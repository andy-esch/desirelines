import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ChartsPage from "./ChartsPage";
import { validateChartsSearch } from "../routes/charts";
import * as useActivityBucketsModule from "../hooks/useActivityBuckets";
import { aggregateActivities } from "../utils/activityBuckets";
import type { ActivitySummary } from "../api/activities";

vi.mock("../hooks/useActivityBuckets");
vi.mock("../hooks/useUserProfile", () => ({
  useUserProfile: () => ({ displayName: "Athlete", loading: false }),
}));
vi.mock("../hooks/useUserConfig", () => ({
  useUserConfig: () => ({ data: null, isLoading: false }),
}));
vi.mock("../hooks/useSportConfig", () => ({
  useSportConfig: () => ({ sportConfig: null, isLoading: false }),
}));
vi.mock("../hooks/useVisibleSports", () => ({
  useVisibleSports: () => ({ visibleSports: ["cycling", "running", "yoga"] }),
}));

function activity(over: Partial<ActivitySummary>): ActivitySummary {
  return {
    id: "1",
    name: "Activity",
    sport: "cycling",
    startDateLocal: "2026-05-10T08:00:00",
    distanceMeters: 30000,
    movingTimeSeconds: 3600,
    hasRoute: true,
    ...over,
  } as ActivitySummary;
}

// Fixtures stay as activities and run through the REAL aggregation, so these
// tests keep asserting the same end-to-end behavior the client-side data
// source had — the hook mock just skips the fetch.
function mockAllActivities(activities: ActivitySummary[], over: Record<string, unknown> = {}) {
  vi.mocked(useActivityBucketsModule.useActivityBuckets).mockReturnValue({
    buckets: aggregateActivities(activities),
    isLoading: false,
    error: null,
    retry: vi.fn(),
    ...over,
  });
}

async function renderChartsPage(initialRoute = "/charts") {
  const rootRoute = createRootRoute();
  const chartsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/charts",
    component: ChartsPage,
    validateSearch: validateChartsSearch,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([chartsRoute]),
    history: createMemoryHistory({ initialEntries: [initialRoute] }),
  });
  await router.load();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("ChartsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconciles outdoor vs indoor/virtual counts over the filtered set", async () => {
    mockAllActivities([
      activity({ sport: "cycling", hasRoute: true }),
      activity({ sport: "running", hasRoute: true }),
      activity({ sport: "yoga", hasRoute: false, distanceMeters: 0 }),
    ]);
    await renderChartsPage();
    // 2 outdoor + 1 indoor, matching the input split.
    expect(screen.getByText(/2 outdoor · 1 indoor \/ virtual/)).toBeInTheDocument();
  });

  it("filters to indoor/virtual only via the type control, noting when none exist", async () => {
    const user = userEvent.setup();
    mockAllActivities([activity({ sport: "cycling", hasRoute: true })]); // purely outdoor
    await renderChartsPage();

    await user.click(screen.getByRole("button", { name: /indoor \/ virtual/i }));
    // Caption still shows the full split, plus a "none of this type" note.
    expect(screen.getByText(/1 outdoor · 0 indoor \/ virtual/)).toBeInTheDocument();
    expect(screen.getByText(/no indoor \/ virtual activities in this range/i)).toBeInTheDocument();
  });

  it("offers a metric toggle (distance default) and switches without crashing", async () => {
    const user = userEvent.setup();
    mockAllActivities([activity({ sport: "cycling", hasRoute: true })]);
    await renderChartsPage();

    const timeButton = screen.getByRole("button", { name: /time/i });
    expect(timeButton).toHaveAttribute("aria-pressed", "false");
    await user.click(timeButton);
    expect(timeButton).toHaveAttribute("aria-pressed", "true");
  });

  it("renders an empty state when no activities match the filter", async () => {
    mockAllActivities([]);
    await renderChartsPage();
    expect(screen.getByText(/no activities in this range/i)).toBeInTheDocument();
  });

  it("renders (demo/loaded) without requiring a signed-in user", async () => {
    mockAllActivities([activity({ sport: "cycling", hasRoute: true })]);
    await renderChartsPage();
    expect(screen.getByRole("heading", { name: "Charts" })).toBeInTheDocument();
  });

  it("shows the loading state while the activity set is still paging in", async () => {
    mockAllActivities([], { isLoading: true });
    await renderChartsPage();
    expect(screen.getByLabelText(/loading chart data/i)).toBeInTheDocument();
  });

  it("surfaces an error with a working Retry instead of masking it as loading", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    mockAllActivities([], { error: new Error("Network Error"), retry });
    await renderChartsPage();

    // ChartContainer must render the error alert (not a perpetual spinner) so the
    // user can recover — this guards against the loading/error masking regression.
    expect(screen.getByRole("alert")).toHaveTextContent(/network error/i);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the active-filter pill for a non-default range + sport", async () => {
    mockAllActivities([activity({ sport: "cycling", hasRoute: true })]);
    await renderChartsPage("/charts?range=6m&sports=cycling");
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeInTheDocument();
    expect(document.body.textContent).toContain("6 Months");
    expect(document.body.textContent).toContain("Cycling");
  });

  it("hides the active-filter pill when filters are at their defaults", async () => {
    mockAllActivities([activity({ sport: "cycling", hasRoute: true })]);
    await renderChartsPage(); // "/charts" → ytd default, no sport = no filter
    expect(screen.queryByRole("button", { name: /clear filters/i })).not.toBeInTheDocument();
  });

  it("adds a sport to the filter when its chip is toggled, keeping the range", async () => {
    mockAllActivities([activity({ sport: "cycling", hasRoute: true })]);
    const user = userEvent.setup();
    await renderChartsPage("/charts?range=6m");

    await user.click(screen.getByRole("button", { name: "Cycling" }));

    await waitFor(() => {
      expect(vi.mocked(useActivityBucketsModule.useActivityBuckets)).toHaveBeenCalledWith(
        expect.objectContaining({ sports: ["cycling"] })
      );
    });
    // Range survives the sport toggle (setSearch merges, not replaces).
    expect(document.body.textContent).toContain("6 Months");
  });
});
