import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ActivitiesPage = lazy(() => import("../pages/ActivitiesPage"));

type ActivitiesSearch = {
  range?: string;
  sport?: string;
};

export const Route = createFileRoute("/activities")({
  component: ActivitiesPage,
  validateSearch: (search: Record<string, unknown>): ActivitiesSearch => ({
    range: typeof search.range === "string" ? search.range : undefined,
    sport: typeof search.sport === "string" ? search.sport : undefined,
  }),
});
