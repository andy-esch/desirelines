import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const RoutesPage = lazy(() => import("../pages/RoutesPage"));

/**
 * Validate the `?activity=<id>` deep link (from the activity lists' "View on map").
 * Coerce to a positive integer (protojson ids are large int64s arriving as a string
 * in the URL); drop anything else so a malformed param falls back to the full map.
 */
export function validateRoutesSearch(search: Record<string, unknown>): { activity?: number } {
  const raw = search.activity;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? { activity: n } : {};
}

export const Route = createFileRoute("/routes")({
  validateSearch: validateRoutesSearch,
  component: RoutesPage,
});
