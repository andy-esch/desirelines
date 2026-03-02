import { useRouteData } from "../hooks/useRouteData";
import RouteCanvas from "../components/routes/RouteCanvas";
import { PageLayout } from "../components/layout/PageLayout";
import { useAuth } from "../hooks/useAuth";
import { Link } from "@tanstack/react-router";

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex grow items-center justify-center">
      {children}
    </div>
  );
}

export default function RoutesPage() {
  const { user, loading: authLoading } = useAuth();
  const { routes, isLoading, error } = useRouteData();

  // Not authenticated
  if (!authLoading && !user) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-white/50">
            <Link to="/" className="text-accent-cyan no-underline">
              Sign in
            </Link>{" "}
            to view your route art.
          </p>
        </StatusMessage>
      </PageLayout>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-white/50">Loading routes...</p>
        </StatusMessage>
      </PageLayout>
    );
  }

  // Error
  if (error) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-red-400">Failed to load routes. Please try again later.</p>
        </StatusMessage>
      </PageLayout>
    );
  }

  // Empty
  if (routes.length === 0) {
    return (
      <PageLayout background="routes">
        <StatusMessage>
          <p className="text-white/50">No routes yet. Go record some activities!</p>
        </StatusMessage>
      </PageLayout>
    );
  }

  return (
    <PageLayout background="routes">
      <div className="fixed inset-0 bg-bg-body">
        <RouteCanvas routes={routes} />
      </div>
    </PageLayout>
  );
}
