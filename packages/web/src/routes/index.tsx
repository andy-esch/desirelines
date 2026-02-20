import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const Dashboard = lazy(() => import("../pages/Dashboard"));

export const Route = createFileRoute("/")({
  component: Dashboard,
});
