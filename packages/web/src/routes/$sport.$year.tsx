import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const UnifiedSportPage = lazy(() => import("../pages/UnifiedSportPage"));

function SportYearPage() {
  const { sport, year } = Route.useParams();
  return <UnifiedSportPage sport={sport} year={year} />;
}

export const Route = createFileRoute("/$sport/$year")({
  component: SportYearPage,
});
