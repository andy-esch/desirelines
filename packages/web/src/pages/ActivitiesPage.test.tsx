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
import * as useActivitiesModule from "../hooks/useActivities";

// Mock dependencies - useActivities is mocked; useAuth is called internally
// by useActivities but that's fully mocked so useAuth never runs.
vi.mock("../hooks/useActivities");
vi.mock("../hooks/useUserConfig", () => ({
  useUserConfig: () => ({ data: null, isLoading: false }),
}));
vi.mock("../hooks/useSportConfig", () => ({
  useSportConfig: () => ({ sportConfig: null, isLoading: false }),
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
    validateSearch: (search: Record<string, unknown>) => ({
      range: typeof search.range === "string" ? search.range : undefined,
      sport: typeof search.sport === "string" ? search.sport : undefined,
    }),
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
      id: 123456789,
      name: "Morning Ride",
      type: "Ride",
      sport: "cycling",
      startDateLocal: "2025-12-28T08:30:00",
      distanceMeters: 45000,
      movingTimeSeconds: 5400,
      elevationMeters: 450,
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
      expect(screen.getByLabelText("Time:")).toBeInTheDocument();
      expect(screen.getByLabelText("Sport:")).toBeInTheDocument();
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

    it("renders time range filter", async () => {
      await renderActivitiesPage();

      expect(screen.getByLabelText("Time:")).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Time:" })).toBeInTheDocument();
    });

    it("renders sport filter", async () => {
      await renderActivitiesPage();

      expect(screen.getByLabelText("Sport:")).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Sport:" })).toBeInTheDocument();
    });

    it("has all time range options", async () => {
      await renderActivitiesPage();

      const timeSelect = screen.getByRole("combobox", { name: "Time:" });
      expect(timeSelect).toContainElement(screen.getByText("2 Weeks"));
      expect(timeSelect).toContainElement(screen.getByText("4 Weeks"));
      expect(timeSelect).toContainElement(screen.getByText("2 Months"));
      expect(timeSelect).toContainElement(screen.getByText("6 Months"));
      expect(timeSelect).toContainElement(screen.getByText("Year to Date"));
      expect(timeSelect).toContainElement(screen.getByText("All Time"));
    });

    it("has all sport options", async () => {
      await renderActivitiesPage();

      const sportSelect = screen.getByRole("combobox", { name: "Sport:" });
      expect(sportSelect).toContainElement(screen.getByText("All Sports"));
      expect(sportSelect).toContainElement(screen.getByText("Cycling"));
      expect(sportSelect).toContainElement(screen.getByText("Running"));
      expect(sportSelect).toContainElement(screen.getByText("Yoga"));
    });

    it("defaults to 4 weeks time range", async () => {
      await renderActivitiesPage();

      const timeSelect = screen.getByRole("combobox", { name: "Time:" });
      expect(timeSelect).toHaveValue("4w");
    });

    it("defaults to all sports", async () => {
      await renderActivitiesPage();

      const sportSelect = screen.getByRole("combobox", { name: "Sport:" });
      expect(sportSelect).toHaveValue("");
    });

    it("calls useActivities with filter when sport changes", async () => {
      const user = userEvent.setup();
      const useActivitiesSpy = vi.spyOn(useActivitiesModule, "useActivities");

      await renderActivitiesPage();

      const sportSelect = screen.getByRole("combobox", { name: "Sport:" });
      await user.selectOptions(sportSelect, "cycling");

      await waitFor(() => {
        expect(useActivitiesSpy).toHaveBeenCalledWith(
          expect.objectContaining({ sport: "cycling" })
        );
      });
    });

    it("reads initial filter from URL", async () => {
      const useActivitiesSpy = vi.spyOn(useActivitiesModule, "useActivities");

      await renderActivitiesPage("/activities?range=2m&sport=running");

      expect(useActivitiesSpy).toHaveBeenCalledWith(expect.objectContaining({ sport: "running" }));
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
