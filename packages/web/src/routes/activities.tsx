import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { lazy } from "react";

const ActivitiesPage = lazy(() => import("../pages/ActivitiesPage"));

type ActivitiesSearch = {
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
export function validateActivitiesSearch(search: Record<string, unknown>): ActivitiesSearch {
  return {
    range: typeof search.range === "string" ? search.range : undefined,
    sports: typeof search.sports === "string" ? search.sports : undefined,
  };
}

export const Route = createFileRoute("/activities")({
  component: ActivitiesPage,
  validateSearch: validateActivitiesSearch,
  search: {
    // Nav links pass the whole previous search through; each Activities-group
    // route strips the params it doesn't model, so the shared `sports` (and
    // `range`, shared with /charts) carry across views with no per-link
    // translation.
    middlewares: [stripSearchParams(["from", "to", "dmin", "dmax", "region", "activity"])],
  },
});
