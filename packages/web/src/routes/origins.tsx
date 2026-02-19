import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const OriginsPage = lazy(() => import("../pages/OriginsPage"));

export const Route = createFileRoute("/origins")({
  component: OriginsPage,
});
