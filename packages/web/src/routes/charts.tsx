import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ChartsPage = lazy(() => import("../pages/ChartsPage"));

type ChartsSearch = {
  range?: string | undefined;
  sport?: string | undefined;
};

// Shared with /activities so a range+sport selection persists across the
// Activities-group views.
export const Route = createFileRoute("/charts")({
  component: ChartsPage,
  validateSearch: (search: Record<string, unknown>): ChartsSearch => ({
    range: typeof search.range === "string" ? search.range : undefined,
    sport: typeof search.sport === "string" ? search.sport : undefined,
  }),
});
