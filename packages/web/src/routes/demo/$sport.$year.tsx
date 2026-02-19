import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy } from "react";
import { getCurrentYear } from "../../hooks/useCurrentYear";

const DemoSportPage = lazy(() => import("../../pages/DemoSportPage"));

const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

function DemoSportYearPage() {
  const { sport, year } = Route.useParams();
  return <DemoSportPage sport={sport} year={year} />;
}

export const Route = createFileRoute("/demo/$sport/$year")({
  beforeLoad: ({ params }) => {
    const parsed = Number(params.year);
    if (!Number.isInteger(parsed) || parsed < MIN_YEAR || parsed > MAX_YEAR) {
      throw redirect({
        to: "/demo/$sport/$year",
        params: { sport: params.sport, year: String(getCurrentYear()) },
        replace: true,
      });
    }
  },
  component: DemoSportYearPage,
});
