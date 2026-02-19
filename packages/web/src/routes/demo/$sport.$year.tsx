import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const DemoSportPage = lazy(() => import("../../pages/DemoSportPage"));

function DemoSportYearPage() {
  const { sport, year } = Route.useParams();
  return <DemoSportPage sport={sport} year={year} />;
}

export const Route = createFileRoute("/demo/$sport/$year")({
  component: DemoSportYearPage,
});
