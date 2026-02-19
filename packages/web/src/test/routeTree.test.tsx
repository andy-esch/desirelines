import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  redirect,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { getCurrentYear } from "../hooks/useCurrentYear";
import { getDemoSports } from "../utils/demoDataGenerator";

// ---------------------------------------------------------------------------
// Stub components — lightweight replacements for heavy page components.
// Each renders a marker so we can assert which route matched.
// ---------------------------------------------------------------------------
function StubDashboard() {
  return <div data-testid="page-dashboard">Dashboard</div>;
}
function StubActivities() {
  return <div data-testid="page-activities">Activities</div>;
}
function StubSportYear({ sport, year }: { sport: string; year: string }) {
  return (
    <div data-testid="page-sport-year">
      {sport}/{year}
    </div>
  );
}
function StubDemoSportYear({ sport, year }: { sport: string; year: string }) {
  return (
    <div data-testid="page-demo-sport-year">
      demo/{sport}/{year}
    </div>
  );
}
function StubNotFound() {
  return <div data-testid="not-found">Not Found</div>;
}

// ---------------------------------------------------------------------------
// Route tree — mirrors the real route structure with the same beforeLoad logic
// but uses stub components to keep tests fast and dependency-free.
// ---------------------------------------------------------------------------
const SPORT_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;
const DEMO_SPORTS = getDemoSports();
const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

function buildRouteTree() {
  const rootRoute = createRootRoute({
    component: Outlet,
    notFoundComponent: StubNotFound,
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: StubDashboard,
  });

  const activitiesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/activities",
    component: StubActivities,
    validateSearch: (search: Record<string, unknown>) => ({
      range: typeof search.range === "string" ? search.range : undefined,
      sport: typeof search.sport === "string" ? search.sport : undefined,
    }),
  });

  // /$sport layout
  const sportLayout = createRoute({
    getParentRoute: () => rootRoute,
    path: "$sport",
    component: Outlet,
    beforeLoad: ({ params }) => {
      if (!SPORT_SLUG_PATTERN.test(params.sport)) {
        throw notFound();
      }
    },
  });

  // /$sport/ → redirect to /$sport/$year
  const sportIndex = createRoute({
    getParentRoute: () => sportLayout,
    path: "/",
    beforeLoad: ({ params }) => {
      throw redirect({
        to: "/$sport/$year",
        params: { sport: params.sport, year: String(getCurrentYear()) },
        replace: true,
      });
    },
  });

  // /$sport/$year
  const sportYear = createRoute({
    getParentRoute: () => sportLayout,
    path: "$year",
    component: () => {
      const params = sportYear.useParams();
      return <StubSportYear sport={params.sport} year={params.year} />;
    },
    beforeLoad: ({ params }) => {
      const parsed = Number(params.year);
      if (!Number.isInteger(parsed) || parsed < MIN_YEAR || parsed > MAX_YEAR) {
        throw redirect({
          to: "/$sport/$year",
          params: { sport: params.sport, year: String(getCurrentYear()) },
          replace: true,
        });
      }
    },
  });

  // /demo
  const demoIndex = createRoute({
    getParentRoute: () => rootRoute,
    path: "/demo",
    component: StubDashboard,
  });

  // /demo/$sport layout
  const demoSportLayout = createRoute({
    getParentRoute: () => rootRoute,
    path: "/demo/$sport",
    component: Outlet,
    beforeLoad: ({ params }) => {
      if (!DEMO_SPORTS.includes(params.sport)) {
        throw redirect({ to: "/demo", replace: true });
      }
    },
  });

  // /demo/$sport/ → redirect to /demo/$sport/$year
  const demoSportIndex = createRoute({
    getParentRoute: () => demoSportLayout,
    path: "/",
    beforeLoad: ({ params }) => {
      if (!DEMO_SPORTS.includes(params.sport)) {
        throw redirect({ to: "/demo", replace: true });
      }
      throw redirect({
        to: "/demo/$sport/$year",
        params: { sport: params.sport, year: String(getCurrentYear()) },
        replace: true,
      });
    },
  });

  // /demo/$sport/$year
  const demoSportYear = createRoute({
    getParentRoute: () => demoSportLayout,
    path: "$year",
    component: () => {
      const params = demoSportYear.useParams();
      return <StubDemoSportYear sport={params.sport} year={params.year} />;
    },
    beforeLoad: ({ params }) => {
      const parsed = Number(params.year);
      if (!Number.isInteger(parsed) || parsed < MIN_YEAR || parsed > MAX_YEAR) {
        throw redirect({
          to: "/demo/$sport/$year",
          params: { sport: params.sport, year: String(getCurrentYear()) },
          replace: true,
        });
      }
    },
  });

  return rootRoute.addChildren([
    indexRoute,
    activitiesRoute,
    sportLayout.addChildren([sportIndex, sportYear]),
    demoIndex,
    demoSportLayout.addChildren([demoSportIndex, demoSportYear]),
  ]);
}

// ---------------------------------------------------------------------------
// Helper — creates a router, loads it, and renders it
// ---------------------------------------------------------------------------
async function renderRoute(initialUrl: string) {
  const routeTree = buildRouteTree();
  const history = createMemoryHistory({ initialEntries: [initialUrl] });
  const router = createRouter({ routeTree, history });
  await router.load();
  const result = render(<RouterProvider router={router} />);
  return { ...result, router };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const currentYear = getCurrentYear();

describe("route tree", () => {
  describe("index route", () => {
    it("renders dashboard at /", async () => {
      await renderRoute("/");
      expect(screen.getByTestId("page-dashboard")).toBeInTheDocument();
    });
  });

  describe("/$sport/ redirect", () => {
    it("redirects /$sport/ to /$sport/$currentYear", async () => {
      const { router } = await renderRoute("/cycling");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/cycling/${currentYear}`);
      });
      expect(screen.getByTestId("page-sport-year")).toHaveTextContent(`cycling/${currentYear}`);
    });
  });

  describe("/$sport/$year rendering", () => {
    it("renders sport page with valid sport and year", async () => {
      await renderRoute("/cycling/2025");
      expect(screen.getByTestId("page-sport-year")).toHaveTextContent("cycling/2025");
    });

    it("renders sport page for different sports", async () => {
      await renderRoute("/running/2024");
      expect(screen.getByTestId("page-sport-year")).toHaveTextContent("running/2024");
    });
  });

  describe("sport param validation", () => {
    it("rejects sport with uppercase letters", async () => {
      await renderRoute("/Cycling/2025");
      expect(screen.getByTestId("not-found")).toBeInTheDocument();
    });

    it("rejects sport with dots (e.g. favicon.ico)", async () => {
      await renderRoute("/favicon.ico");
      expect(screen.getByTestId("not-found")).toBeInTheDocument();
    });

    it("accepts hyphenated sport slugs", async () => {
      await renderRoute("/mountain-bike/2025");
      expect(screen.getByTestId("page-sport-year")).toHaveTextContent("mountain-bike/2025");
    });
  });

  describe("year param validation", () => {
    it("redirects non-numeric year to current year", async () => {
      const { router } = await renderRoute("/cycling/abc");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/cycling/${currentYear}`);
      });
    });

    it("redirects year below MIN_YEAR to current year", async () => {
      const { router } = await renderRoute("/cycling/1999");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/cycling/${currentYear}`);
      });
    });

    it("redirects year above MAX_YEAR to current year", async () => {
      const { router } = await renderRoute("/cycling/2100");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/cycling/${currentYear}`);
      });
    });

    it("accepts year at MIN_YEAR boundary", async () => {
      await renderRoute("/cycling/2000");
      expect(screen.getByTestId("page-sport-year")).toHaveTextContent("cycling/2000");
    });

    it("accepts year at MAX_YEAR boundary", async () => {
      await renderRoute("/cycling/2099");
      expect(screen.getByTestId("page-sport-year")).toHaveTextContent("cycling/2099");
    });

    it("redirects decimal year to current year", async () => {
      const { router } = await renderRoute("/cycling/2025.5");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/cycling/${currentYear}`);
      });
    });
  });

  describe("demo sport validation", () => {
    it("renders demo sport page for valid demo sport", async () => {
      await renderRoute("/demo/cycling/2025");
      expect(screen.getByTestId("page-demo-sport-year")).toHaveTextContent("demo/cycling/2025");
    });

    it("redirects invalid demo sport to /demo", async () => {
      const { router } = await renderRoute("/demo/invalid-sport/2025");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/demo");
      });
    });

    it("redirects /demo/$sport/ to /demo/$sport/$currentYear", async () => {
      const { router } = await renderRoute("/demo/running");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/demo/running/${currentYear}`);
      });
    });
  });

  describe("demo year validation", () => {
    it("redirects non-numeric demo year to current year", async () => {
      const { router } = await renderRoute("/demo/cycling/abc");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/demo/cycling/${currentYear}`);
      });
    });

    it("redirects out-of-range demo year to current year", async () => {
      const { router } = await renderRoute("/demo/cycling/1999");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/demo/cycling/${currentYear}`);
      });
    });
  });

  describe("activities route", () => {
    it("renders activities page", async () => {
      await renderRoute("/activities");
      expect(screen.getByTestId("page-activities")).toBeInTheDocument();
    });
  });

  describe("404 handling", () => {
    it("shows not-found for paths with invalid sport slugs", async () => {
      // Uppercase triggers the sport slug validation → notFound()
      await renderRoute("/NotASport/2025");
      expect(screen.getByTestId("not-found")).toBeInTheDocument();
    });

    it("shows not-found for paths with dots", async () => {
      await renderRoute("/robots.txt");
      expect(screen.getByTestId("not-found")).toBeInTheDocument();
    });
  });
});
