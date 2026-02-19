import { createFileRoute, redirect } from "@tanstack/react-router";
import { getCurrentYear } from "../hooks/useCurrentYear";

export const Route = createFileRoute("/$sport/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$sport/$year",
      params: { sport: params.sport, year: String(getCurrentYear()) },
      replace: true,
    });
  },
});
