import { createFileRoute, notFound, Outlet, useRouter } from "@tanstack/react-router";
import { PageErrorFallback } from "../components/PageErrorFallback";

// Reject params that are clearly not sport slugs (e.g. "favicon.ico", "robots.txt").
// The full sport list comes from the API, so exact validation happens in hooks.
const SPORT_SLUG_PATTERN = /^[a-z][a-z0-9-]*$/;

function SportErrorComponent({ error }: { error: Error }) {
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

export const Route = createFileRoute("/$sport")({
  beforeLoad: ({ params }) => {
    if (!SPORT_SLUG_PATTERN.test(params.sport)) {
      throw notFound();
    }
  },
  component: Outlet,
  errorComponent: SportErrorComponent,
});
