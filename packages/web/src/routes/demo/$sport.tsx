import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { getDemoSports } from "../../utils/demoDataGenerator";
import { PageErrorFallback } from "../../components/PageErrorFallback";

const DEMO_SPORTS = getDemoSports();

function DemoSportErrorComponent({ error }: { error: Error }) {
  const router = useRouter();
  return (
    <PageErrorFallback
      error={error}
      onReset={() => {
        void router.invalidate();
      }}
    />
  );
}

export const Route = createFileRoute("/demo/$sport")({
  beforeLoad: ({ params }) => {
    if (!DEMO_SPORTS.includes(params.sport)) {
      throw redirect({ to: "/demo", replace: true });
    }
  },
  component: Outlet,
  errorComponent: DemoSportErrorComponent,
});
