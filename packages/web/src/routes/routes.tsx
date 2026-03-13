import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const RoutesPage = lazy(() => import("../pages/RoutesPage"));

type RoutesSearch = {
  sports?: string;
  years?: string;
  rings?: string;
};

export const Route = createFileRoute("/routes")({
  component: RoutesPage,
  validateSearch: (search: Record<string, unknown>): RoutesSearch => ({
    sports: typeof search.sports === "string" ? search.sports : undefined,
    years: typeof search.years === "string" ? search.years : undefined,
    rings: typeof search.rings === "string" ? search.rings : undefined,
  }),
});
