import { createRouter } from "@tanstack/react-router";
import { newNavigationTrace } from "./api/trace";
import { routeTree } from "./routeTree.gen";

export function createAppRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
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
