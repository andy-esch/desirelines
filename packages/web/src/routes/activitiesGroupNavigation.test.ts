import { describe, it, expect, vi } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";

/**
 * Router-level coverage for the Activities-group cross-view filter model: nav
 * links pass the whole search through (`search: true`) and each route's strip
 * middleware drops the params it doesn't model, so `sports` (and `range`
 * between List and Charts) survive every view switch with no per-link
 * translation. Uses the real route tree, so the real validateSearch functions
 * and middlewares are exercised — nothing is re-declared here.
 *
 * The tree is re-imported fresh for every router: route objects are module
 * singletons that keep a backref to the last router built over them, so
 * sharing one tree across createRouter calls bleeds location state between
 * tests (a fresh router reported the previous test's search params).
 */
async function routerAt(initialUrl: string) {
  vi.resetModules();
  const { routeTree } = await import("../routeTree.gen");
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
  await router.load();
  return router;
}

describe("Activities-group cross-view navigation", () => {
  it("keeps sports and drops the map-only params on Routes → List", async () => {
    const router = await routerAt(
      "/routes?sports=cycling,running&from=2026-01-01&to=2026-03-31&dmin=1000&dmax=5000&region=3&activity=123"
    );
    await router.navigate({ to: "/activities", search: true });
    expect(router.state.location.pathname).toBe("/activities");
    expect(router.state.location.search).toEqual({ sports: "cycling,running" });
  });

  it("keeps sports and drops range on List → Routes", async () => {
    const router = await routerAt("/activities?range=2m&sports=cycling");
    await router.navigate({ to: "/routes", search: true });
    expect(router.state.location.pathname).toBe("/routes");
    expect(router.state.location.search).toEqual({ sports: "cycling" });
  });

  it("keeps range and sports between List and Charts", async () => {
    const router = await routerAt("/activities?range=2m&sports=cycling");
    await router.navigate({ to: "/charts", search: true });
    expect(router.state.location.pathname).toBe("/charts");
    expect(router.state.location.search).toEqual({ range: "2m", sports: "cycling" });
  });

  it("keeps sports and drops the map-only params on Routes → Charts", async () => {
    const router = await routerAt("/routes?sports=yoga&dmin=0&dmax=1000&region=7");
    await router.navigate({ to: "/charts", search: true });
    expect(router.state.location.pathname).toBe("/charts");
    expect(router.state.location.search).toEqual({ sports: "yoga" });
  });

  it("PROBE: does a bookmarked URL with foreign params leak when navigating?", async () => {
    const router = await routerAt("/activities?from=2026-01-01&to=2026-03-31");
    // What is the search state immediately after initial load?
    console.log("INITIAL SEARCH STATE:", router.state.location.search);

    await router.navigate({ to: "/routes", search: true });
    console.log("NAVIGATED SEARCH STATE:", router.state.location.search);
  });
});
