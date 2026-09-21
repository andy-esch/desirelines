import { createRouter } from "@tanstack/react-router";
import PageLoader from "./components/PageLoader";
import { newNavigationTrace } from "./api/trace";
import { routeTree } from "./routeTree.gen";

/**
 * Router behaviour shared by the app and by tests that need a router which loads
 * routes the way the real one does.
 *
 * `defaultPendingComponent` is what puts a loading state on screen while a route's
 * chunk downloads. Pages are `React.lazy()` components, so their first render
 * suspends; the root `<Outlet>` wraps every child match in a Suspense boundary of
 * its own whose fallback is this component, and being the nearest boundary it wins
 * over any `<Suspense>` an app component sets up around the outlet. Left unset,
 * that inner fallback is null: on a slow connection the header and footer paint and
 * the page area stays empty until the chunk lands.
 */
export const APP_ROUTER_OPTIONS = {
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultPendingComponent: PageLoader,
} as const;

export function createAppRouter() {
  const router = createRouter({
    routeTree,
    ...APP_ROUTER_OPTIONS,
  });

  // Mint one W3C trace-id per navigation so every request a single user
  // action fires shares it. The apigateway is public-endpoint-mode — it
  // *links* (never parents) this context — turning it into "this
  // navigation → these backend traces" in Cloud Trace. Propagation only;
  // no browser OTel SDK. See ./api/trace.ts.
  router.subscribe("onBeforeNavigate", () => {
    newNavigationTrace();
  });

  return router;
}

// Type registration for full type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
