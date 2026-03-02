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

  let statusContent: React.ReactNode = null;

  if (!authLoading && !user) {
    statusContent = (
      <p className="text-white/50">
        <Link to="/" className="text-accent-cyan no-underline">
          Sign in
        </Link>{" "}
        to view your route art.
      </p>
    );
  } else if (isLoading) {
    statusContent = <p className="text-white/50">Loading routes...</p>;
  } else if (error) {
    statusContent = <p className="text-red-400">Failed to load routes. Please try again later.</p>;
  } else if (routes.length === 0) {
    statusContent = <p className="text-white/50">No routes yet. Go record some activities!</p>;
  }

  if (statusContent) {
    return (
      <PageLayout background="routes">
        <StatusMessage>{statusContent}</StatusMessage>
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
