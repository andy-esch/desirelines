import { useRouteData } from "../hooks/useRouteData";
import RouteCanvas from "../components/routes/RouteCanvas";
import { useAuth } from "../hooks/useAuth";
import { Link } from "@tanstack/react-router";

const BG_COLOR = "#0f1724";

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{ height: "100vh", backgroundColor: BG_COLOR }}
    >
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
      <StatusMessage>
        <p className="text-white/50">
          <Link to="/" className="text-accent-cyan no-underline">
            Sign in
          </Link>{" "}
          to view your route art.
        </p>
      </StatusMessage>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <StatusMessage>
        <p className="text-white/50">Loading routes...</p>
      </StatusMessage>
    );
  }

  // Error
  if (error) {
    return (
      <StatusMessage>
        <p className="text-red-400">Failed to load routes. Please try again later.</p>
      </StatusMessage>
    );
  }

  // Empty
  if (routes.length === 0) {
    return (
      <StatusMessage>
        <p className="text-white/50">No routes yet. Go record some activities!</p>
      </StatusMessage>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: BG_COLOR }}>
      <RouteCanvas routes={routes} />
    </div>
  );
}
