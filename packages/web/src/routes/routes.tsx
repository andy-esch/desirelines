import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const RoutesPage = lazy(() => import("../pages/RoutesPage"));

export const Route = createFileRoute("/routes")({
  component: RoutesPage,
});
