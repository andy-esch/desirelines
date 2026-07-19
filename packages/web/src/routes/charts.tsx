import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ChartsPage = lazy(() => import("../pages/ChartsPage"));

type ChartsSearch = {
  range?: string | undefined;
  sports?: string | undefined;
};

// Shared with /activities so a range+sports selection persists across the
// Activities-group views.
export const Route = createFileRoute("/charts")({
  component: ChartsPage,
  validateSearch: (search: Record<string, unknown>): ChartsSearch => ({
    range: typeof search.range === "string" ? search.range : undefined,
    sports: typeof search.sports === "string" ? search.sports : undefined,
  }),
});
