import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";
import {
  parseActivityFilterSearch,
  type ActivityFilterSearch,
} from "../utils/activityFilterSearch";

const RoutesPage = lazy(() => import("../pages/RoutesPage"));

/**
 * Validate the routes-map search: the shared Activities-group cross-filter params
 * (sports/date/distance/region) plus the `?activity=<id>` deep link (from the
 * activity lists' "View on map"). The id is coerced to a positive integer
 * (protojson ids are large int64s arriving as a string); anything malformed drops
 * so it falls back to the full map.
 */
export function validateRoutesSearch(
  search: Record<string, unknown>
): ActivityFilterSearch & { activity?: number } {
  const filters = parseActivityFilterSearch(search);
  const raw = search.activity;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? { ...filters, activity: n } : filters;
}

export const Route = createFileRoute("/routes")({
  validateSearch: validateRoutesSearch,
  component: RoutesPage,
});
