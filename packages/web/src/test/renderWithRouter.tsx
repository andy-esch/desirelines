import { render, type RenderOptions } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

interface RenderWithRouterOptions extends Omit<RenderOptions, "wrapper"> {
  /** Initial URL to render at (default: "/") */
  route?: string;
  /** Additional wrapper component (e.g., providers) */
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}

/**
 * Test utility that replaces MemoryRouter for TanStack Router tests.
 *
 * Creates a minimal router with a catch-all route that renders the provided UI.
 * Supports setting the initial URL via the `route` option.
 *
 * Must be awaited — the router loads asynchronously before rendering.
 *
 * Limitations (by design — this is for component-level tests):
 * - Uses a catch-all route, so invalid paths won't trigger 404 handling.
 * - No beforeLoad validation — route param validation is not exercised.
 * - No validateSearch — search param validation is not exercised.
 * - No errorComponent/notFoundComponent from __root.tsx.
 *
 * For route-level integration tests that need the real route tree,
 * create a custom router setup (see ActivitiesPage.test.tsx for an example).
 */
export async function renderWithRouter(
  ui: React.ReactElement,
  { route = "/", wrapper: Wrapper, ...renderOptions }: RenderWithRouterOptions = {}
) {
  const rootRoute = createRootRoute();
  const catchAllRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    component: () => ui,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  const routeTree = rootRoute.addChildren([indexRoute, catchAllRoute]);

  const memoryHistory = createMemoryHistory({
    initialEntries: [route],
  });

  const router = createRouter({
    routeTree,
    history: memoryHistory,
  });

  // Pre-load the router so the component renders on first paint
  await router.load();

  const renderResult = render(<RouterProvider router={router} />, {
    wrapper: Wrapper,
    ...renderOptions,
  });

  return { ...renderResult, router };
}
