import { Suspense, lazy } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { APP_ROUTER_OPTIONS } from "./router";

/** A page whose chunk arrives only when the test says so. */
function deferredPage() {
  let arrive!: () => void;
  const chunk = new Promise<{ default: () => React.ReactElement }>((resolve) => {
    arrive = () => resolve({ default: () => <p>page content</p> });
  });
  return { Page: lazy(() => chunk), arrive };
}

/**
 * Mirrors the shape of routes/__root.tsx: chrome that stays put, and a Suspense
 * boundary of the app's own around the outlet.
 */
function rootLayout() {
  return (
    <div>
      <header>site header</header>
      <main>
        <Suspense fallback={<p>app-level fallback</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

function renderRouterWith(Page: React.FunctionComponent) {
  const rootRoute = createRootRoute({ component: rootLayout });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Page });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    ...APP_ROUTER_OPTIONS,
  });
  return render(<RouterProvider router={router} />);
}

describe("app router", () => {
  it("shows the page loader while a lazy route's chunk is still loading", async () => {
    // Regression: the router wraps each child match in a Suspense boundary of its
    // own, nested inside the app's. Without a pending component that inner fallback
    // is null, so it renders nothing and the app's fallback never gets a turn — the
    // page area stayed empty for the whole download. Asserting on the app-level
    // fallback instead of this would pass even with the bug back in place.
    const { Page, arrive } = deferredPage();
    const { container } = renderRouterWith(Page);

    await waitFor(() => {
      expect(container.querySelectorAll(".react-loading-skeleton").length).toBeGreaterThan(0);
    });
    expect(screen.getByText("site header")).toBeInTheDocument();
    expect(screen.queryByText("app-level fallback")).not.toBeInTheDocument();
    expect(screen.queryByText("page content")).not.toBeInTheDocument();

    arrive();
    await waitFor(() => {
      expect(screen.getByText("page content")).toBeInTheDocument();
    });
    expect(container.querySelectorAll(".react-loading-skeleton")).toHaveLength(0);
  });
});
