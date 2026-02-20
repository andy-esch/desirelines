import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentYear } from "../../hooks/useCurrentYear";

// Sport validation is handled by the parent layout route (demo/$sport.tsx).
// This route only handles the redirect to include the current year.
export const Route = createFileRoute("/demo/$sport/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/demo/$sport/$year",
      params: { sport: params.sport, year: String(getCurrentYear()) },
      replace: true,
    });
  },
});
