import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ChartsPage = lazy(() => import("../pages/ChartsPage"));

// Search params (shared with /routes and /activities for cross-view filter
// persistence) are added in the URL-param filter task; for now the placeholder
// takes none.
export const Route = createFileRoute("/charts")({
  component: ChartsPage,
});
