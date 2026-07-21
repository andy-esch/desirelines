import { describe, it, expect } from "vitest";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { pickActivitiesGroupSearch } from "./utils/activitiesGroupParams";

/**
 * Router-level coverage for the Activities-group cross-view filter model: nav
 * links forward only the shared pick (`pickActivitiesGroupSearch`, used here
 * exactly as Navigation does) and each route's strip middleware drops the
 * params it doesn't model, so `sports` (and `range` between List and Charts)
 * survive every view switch while nothing else crosses. Uses the real route
 * tree, so the real validateSearch functions and middlewares are exercised —
 * nothing is re-declared here.
 *
 * Lives outside src/routes/ on purpose: the route generator scans that
 * directory and warns about files that don't export a Route.
 */
async function routerAt(initialUrl: string) {
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
    await router.navigate({ to: "/activities", search: pickActivitiesGroupSearch });
    expect(router.state.location.pathname).toBe("/activities");
    expect(router.state.location.search).toEqual({ sports: "cycling,running" });
  });

  it("keeps sports and drops range on List → Routes", async () => {
    const router = await routerAt("/activities?range=2m&sports=cycling");
    await router.navigate({ to: "/routes", search: pickActivitiesGroupSearch });
    expect(router.state.location.pathname).toBe("/routes");
    expect(router.state.location.search).toEqual({ sports: "cycling" });
  });

  it("keeps range and sports between List and Charts", async () => {
    const router = await routerAt("/activities?range=2m&sports=cycling");
    await router.navigate({ to: "/charts", search: pickActivitiesGroupSearch });
    expect(router.state.location.pathname).toBe("/charts");
    expect(router.state.location.search).toEqual({ range: "2m", sports: "cycling" });
  });

  it("keeps sports and drops the map-only params on Routes → Charts", async () => {
    const router = await routerAt("/routes?sports=yoga&dmin=0&dmax=1000&region=7");
    await router.navigate({ to: "/charts", search: pickActivitiesGroupSearch });
    expect(router.state.location.search).toEqual({ sports: "yoga" });
  });

  it("does not forward bookmarked foreign params to a view that would honor them", async () => {
    // Strip middlewares run on navigation, not initial load, so a bookmarked
    // List URL carrying map params keeps them in its own location — harmless
    // there, since the page reads only range/sports...
    const router = await routerAt("/activities?from=2026-01-01&to=2026-03-31&activity=123");
    expect(router.state.location.search).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
      activity: 123,
    });

    // ...and because nav links forward only the shared pick, they never reach
    // the map, which WOULD model them (a surprise date window + deep link).
    await router.navigate({ to: "/routes", search: pickActivitiesGroupSearch });
    expect(router.state.location.pathname).toBe("/routes");
    expect(router.state.location.search).toEqual({});
  });
});
