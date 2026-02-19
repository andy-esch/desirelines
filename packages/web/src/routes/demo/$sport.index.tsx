import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentYear } from "../../hooks/useCurrentYear";
import { getDemoSports } from "../../utils/demoDataGenerator";

const DEMO_SPORTS = getDemoSports();

export const Route = createFileRoute("/demo/$sport/")({
  beforeLoad: ({ params }) => {
    if (!DEMO_SPORTS.includes(params.sport)) {
      throw redirect({ to: "/demo", replace: true });
    }
    throw redirect({
      to: "/demo/$sport/$year",
      params: { sport: params.sport, year: String(getCurrentYear()) },
      replace: true,
    });
  },
});
