import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { getCurrentYear } from "../hooks/useCurrentYear";

// ---------------------------------------------------------------------------
// Mock page components — replace lazy-loaded pages with lightweight stubs.
// The real route tree's beforeLoad/redirect/validateSearch logic runs unmodified.
// ---------------------------------------------------------------------------
vi.mock("../pages/Dashboard", () => ({
  default: () => <div data-testid="page-dashboard">Dashboard</div>,
}));
vi.mock("../pages/ActivitiesPage", () => ({
  default: () => <div data-testid="page-activities">Activities</div>,
}));
vi.mock("../pages/UnifiedSportPage", () => ({
  default: ({ sport, year }: { sport: string; year: string }) => (
    <div data-testid="page-sport-year">
      {sport}/{year}
    </div>
  ),
}));
vi.mock("../pages/DemoSportPage", () => ({
  default: ({ sport, year }: { sport: string; year: string }) => (
    <div data-testid="page-demo-sport-year">
      demo/{sport}/{year}
    </div>
  ),
}));
vi.mock("../pages/OriginsPage", () => ({
  default: () => <div data-testid="page-origins">Origins</div>,
}));
vi.mock("../pages/SettingsPage", () => ({
  default: () => <div data-testid="page-settings">Settings</div>,
}));

// Mock root layout dependencies to avoid pulling in the full component tree
vi.mock("../components/layout/Header", () => ({
  default: () => <div data-testid="header">Header</div>,
}));
vi.mock("../components/layout/Footer", () => ({
  Footer: () => <div data-testid="footer">Footer</div>,
}));
vi.mock("../components/PageLoader", () => ({
  default: () => null,
}));
vi.mock("../components/PageTransition", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../components/PageErrorFallback", () => ({
  PageErrorFallback: ({ error }: { error: Error }) => (
    <div data-testid="error-fallback">{error.message}</div>
  ),
}));
vi.mock("../hooks/useScrolled", () => ({
  useScrolled: () => false,
}));

// ---------------------------------------------------------------------------
// Import the real route tree — all beforeLoad hooks, redirects, and
// validateSearch functions run exactly as they do in production.
// ---------------------------------------------------------------------------
import { routeTree } from "../routeTree.gen";

// ---------------------------------------------------------------------------
// Helper — creates a router with the real route tree, loads it, and renders
// ---------------------------------------------------------------------------
async function renderRoute(initialUrl: string) {
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
      await waitFor(() => {
        expect(screen.getByTestId("page-dashboard")).toBeInTheDocument();
      });
    });
  });

  describe("/$sport/ redirect", () => {
    it("redirects /$sport/ to /$sport/$currentYear", async () => {
      const { router } = await renderRoute("/cycling");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/cycling/${currentYear}`);
      });
      await waitFor(() => {
        expect(screen.getByTestId("page-sport-year")).toHaveTextContent(`cycling/${currentYear}`);
      });
    });
  });

  describe("/$sport/$year rendering", () => {
    it("renders sport page with valid sport and year", async () => {
      await renderRoute("/cycling/2025");
      await waitFor(() => {
        expect(screen.getByTestId("page-sport-year")).toHaveTextContent("cycling/2025");
      });
    });

    it("renders sport page for different sports", async () => {
      await renderRoute("/running/2024");
      await waitFor(() => {
        expect(screen.getByTestId("page-sport-year")).toHaveTextContent("running/2024");
      });
    });
  });

  describe("sport param validation", () => {
    it("rejects sport with uppercase letters", async () => {
      await renderRoute("/Cycling/2025");
      // Invalid slug triggers notFound() → root Navigate to "/"
      await waitFor(() => {
        expect(screen.getByTestId("page-dashboard")).toBeInTheDocument();
      });
    });

    it("rejects sport with dots (e.g. favicon.ico)", async () => {
      await renderRoute("/favicon.ico");
      await waitFor(() => {
        expect(screen.getByTestId("page-dashboard")).toBeInTheDocument();
      });
    });

    it("accepts hyphenated sport slugs", async () => {
      await renderRoute("/mountain-bike/2025");
      await waitFor(() => {
        expect(screen.getByTestId("page-sport-year")).toHaveTextContent("mountain-bike/2025");
      });
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
      await waitFor(() => {
        expect(screen.getByTestId("page-sport-year")).toHaveTextContent("cycling/2000");
      });
    });

    it("accepts year at MAX_YEAR boundary", async () => {
      await renderRoute("/cycling/2099");
      await waitFor(() => {
        expect(screen.getByTestId("page-sport-year")).toHaveTextContent("cycling/2099");
      });
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
      await waitFor(() => {
        expect(screen.getByTestId("page-demo-sport-year")).toHaveTextContent("demo/cycling/2025");
      });
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
      await waitFor(() => {
        expect(screen.getByTestId("page-activities")).toBeInTheDocument();
      });
    });
  });

  describe("404 handling", () => {
    it("redirects invalid sport slugs to dashboard", async () => {
      const { router } = await renderRoute("/NotASport/2025");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/");
      });
    });

    it("redirects paths with dots to dashboard", async () => {
      const { router } = await renderRoute("/robots.txt");
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/");
      });
    });
  });
});
