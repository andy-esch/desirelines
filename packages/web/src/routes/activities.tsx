import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ActivitiesPage = lazy(() => import("../pages/ActivitiesPage"));

type ActivitiesSearch = {
  range?: string | undefined;
  sports?: string | undefined;
};

export const Route = createFileRoute("/activities")({
  component: ActivitiesPage,
  validateSearch: (search: Record<string, unknown>): ActivitiesSearch => ({
    range: typeof search.range === "string" ? search.range : undefined,
    sports: typeof search.sports === "string" ? search.sports : undefined,
  }),
});
