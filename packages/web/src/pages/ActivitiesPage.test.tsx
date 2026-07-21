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
import ActivitiesPage from "./ActivitiesPage";
import { validateActivitiesSearch } from "../routes/activities";
import * as useActivitiesModule from "../hooks/useActivities";

// Mock dependencies - useActivities is mocked; useAuth is called internally
// by useActivities but that's fully mocked so useAuth never runs.
vi.mock("../hooks/useActivities");
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

/**
 * Create a router with an /activities route that has validateSearch
 * and renders ActivitiesPage, matching the real route configuration.
 */
async function renderActivitiesPage(initialRoute = "/activities") {
  const rootRoute = createRootRoute();
  const activitiesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/activities",
    component: ActivitiesPage,
    validateSearch: validateActivitiesSearch,
  });
  const routeTree = rootRoute.addChildren([activitiesRoute]);

  const memoryHistory = createMemoryHistory({
    initialEntries: [initialRoute],
  });

  const router = createRouter({
    routeTree,
    history: memoryHistory,
  });

  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("ActivitiesPage", () => {
  const mockActivities = [
    {
      id: "123456789",
      name: "Morning Ride",
      type: "Ride",
      sport: "cycling",
      startDateLocal: "2025-12-28T08:30:00",
      distanceMeters: 45000,
      movingTimeSeconds: 5400,
      elevationMeters: 450,
      hasRoute: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("authentication", () => {
    it("shows activities page with filters when not authenticated", async () => {
      vi.spyOn(useActivitiesModule, "useActivities").mockReturnValue({
        activities: [],
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: vi.fn(),
        retry: vi.fn(),
      });

      await renderActivitiesPage();

      expect(screen.getByText("Activities")).toBeInTheDocument();
      expect(screen.getByText("Time:")).toBeInTheDocument();
      expect(screen.getByText("Sport:")).toBeInTheDocument();
    });

    it("shows activities when authenticated", async () => {
      vi.spyOn(useActivitiesModule, "useActivities").mockReturnValue({
        activities: mockActivities,
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: vi.fn(),
        retry: vi.fn(),
      });

      await renderActivitiesPage();

      expect(screen.getByText("Activities")).toBeInTheDocument();
      expect(screen.getByText("Morning Ride")).toBeInTheDocument();
    });
  });

  describe("filters", () => {
    beforeEach(() => {
      vi.spyOn(useActivitiesModule, "useActivities").mockReturnValue({
        activities: mockActivities,
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: vi.fn(),
        retry: vi.fn(),
      });
    });

    it("renders the time-range select showing the current range", async () => {
      await renderActivitiesPage();

      // Default route → 4w; the Select trigger shows its label (options are portaled).
      expect(screen.getByText("4 Weeks")).toBeInTheDocument();
    });

    it("renders a colored pill per visible sport (no dropdown, no All-Sports chip)", async () => {
      await renderActivitiesPage();

      expect(screen.getByRole("button", { name: "Cycling" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Running" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Yoga" })).toBeInTheDocument();
      // "All sports" is the empty selection (deselect), not its own chip.
      expect(screen.queryByRole("button", { name: "All Sports" })).not.toBeInTheDocument();
    });

    it("offers every time-range preset when opened", async () => {
      const user = userEvent.setup();
      await renderActivitiesPage();

      await user.click(screen.getByText("4 Weeks")); // open the select
      expect(await screen.findByRole("option", { name: "2 Weeks" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "2 Months" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "6 Months" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Year to Date" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "All Time" })).toBeInTheDocument();
    });

    it("has no sport pill pressed by default (all sports)", async () => {
      await renderActivitiesPage();

      expect(screen.getByRole("button", { name: "Cycling" })).toHaveAttribute(
        "aria-pressed",
        "false"
      );
    });

    it("calls useActivities with the filter when a sport pill is selected", async () => {
      const user = userEvent.setup();
      const useActivitiesSpy = vi.spyOn(useActivitiesModule, "useActivities");

      await renderActivitiesPage();

      await user.click(screen.getByRole("button", { name: "Cycling" }));

      await waitFor(() => {
        expect(useActivitiesSpy).toHaveBeenCalledWith(
          expect.objectContaining({ sports: ["cycling"] })
        );
      });
    });

    it("accumulates a multi-sport selection across pill clicks", async () => {
      const user = userEvent.setup();
      const useActivitiesSpy = vi.spyOn(useActivitiesModule, "useActivities");

      await renderActivitiesPage();

      await user.click(screen.getByRole("button", { name: "Running" }));
      await user.click(screen.getByRole("button", { name: "Cycling" }));

      // Normalized (sorted) regardless of click order.
      await waitFor(() => {
        expect(useActivitiesSpy).toHaveBeenCalledWith(
          expect.objectContaining({ sports: ["cycling", "running"] })
        );
      });
    });

    it("returns to all sports when the last pill is deselected", async () => {
      const user = userEvent.setup();
      const useActivitiesSpy = vi.spyOn(useActivitiesModule, "useActivities");

      await renderActivitiesPage("/activities?sports=cycling");

      await user.click(screen.getByRole("button", { name: "Cycling" }));

      await waitFor(() => {
        expect(useActivitiesSpy).toHaveBeenCalledWith(expect.objectContaining({ sports: [] }));
      });
    });

    it("reads initial filter from URL", async () => {
      const useActivitiesSpy = vi.spyOn(useActivitiesModule, "useActivities");

      await renderActivitiesPage("/activities?range=2m&sports=running");

      expect(useActivitiesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sports: ["running"] })
      );
    });

    it("normalizes a duplicated, unordered sports param from the URL", async () => {
      const useActivitiesSpy = vi.spyOn(useActivitiesModule, "useActivities");

      await renderActivitiesPage("/activities?sports=running,cycling,running");

      expect(useActivitiesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sports: ["cycling", "running"] })
      );
    });

    it("summarizes three selected sports in the filter pill", async () => {
      await renderActivitiesPage("/activities?sports=cycling,running,yoga");

      expect(screen.getByText(/3 sports/)).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("shows loading state while auth is loading", async () => {
      vi.spyOn(useActivitiesModule, "useActivities").mockReturnValue({
        activities: [],
        isLoading: true,
        error: null,
        hasMore: false,
        loadMore: vi.fn(),
        retry: vi.fn(),
      });

      await renderActivitiesPage();

      // Page renders normally during loading (no auth gate)
      expect(screen.getByText("Activities")).toBeInTheDocument();
    });
  });

  describe("page header", () => {
    it("displays page title", async () => {
      vi.spyOn(useActivitiesModule, "useActivities").mockReturnValue({
        activities: [],
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: vi.fn(),
        retry: vi.fn(),
      });

      await renderActivitiesPage();

      expect(screen.getByRole("heading", { name: "Activities" })).toBeInTheDocument();
    });
  });
});
