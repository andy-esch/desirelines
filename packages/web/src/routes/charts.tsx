import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { lazy } from "react";
import { MAP_ONLY_SEARCH_PARAMS } from "../utils/activitiesGroupParams";

const ChartsPage = lazy(() => import("../pages/ChartsPage"));

// Shared with /activities so a range+sports selection persists across the
// Activities-group views.
type ChartsSearch = {
  range?: string | undefined;
  sports?: string | undefined;
  // Params belonging to the routes map (date window / distance / region /
  // activity deep link). Admitted to the schema only so the strip middleware
  // below can remove them; validateSearch never returns them.
  from?: never;
  to?: never;
  dmin?: never;
  dmax?: never;
  region?: never;
  activity?: never;
};

/** Exported so the page-test harness validates with the real route logic. */
export function validateChartsSearch(search: Record<string, unknown>): ChartsSearch {
  return {
    range: typeof search.range === "string" ? search.range : undefined,
    sports: typeof search.sports === "string" ? search.sports : undefined,
  };
}

export const Route = createFileRoute("/charts")({
  component: ChartsPage,
  validateSearch: validateChartsSearch,
  search: {
    // Nav links forward the shared pick (pickActivitiesGroupSearch); this
    // middleware is the declarative backstop that strips the params this route
    // doesn't model from any other navigation targeting it.
    middlewares: [stripSearchParams([...MAP_ONLY_SEARCH_PARAMS])],
  },
});
