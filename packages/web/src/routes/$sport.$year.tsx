import { createFileRoute, redirect } from "@tanstack/react-router";
import { lazy } from "react";
import { getCurrentYear } from "../hooks/useCurrentYear";

const UnifiedSportPage = lazy(() => import("../pages/UnifiedSportPage"));

const MIN_YEAR = 2000;
const MAX_YEAR = 2099;

function SportYearPage() {
  const { sport, year } = Route.useParams();
  return <UnifiedSportPage sport={sport} year={year} />;
}

export const Route = createFileRoute("/$sport/$year")({
  beforeLoad: ({ params }) => {
    const parsed = Number(params.year);
    if (!Number.isInteger(parsed) || parsed < MIN_YEAR || parsed > MAX_YEAR) {
      throw redirect({
        to: "/$sport/$year",
        params: { sport: params.sport, year: String(getCurrentYear()) },
        replace: true,
      });
    }
  },
  component: SportYearPage,
});
