import { useRouteData } from "../hooks/useRouteData";
import RouteCanvas from "../components/routes/RouteCanvas";
import { useAuth } from "../hooks/useAuth";
import { Link } from "@tanstack/react-router";

export default function RoutesPage() {
  const { user, loading: authLoading } = useAuth();
  const { routes, isLoading, error } = useRouteData();

  // Not authenticated
  if (!authLoading && !user) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "100vh", backgroundColor: "#0f1724" }}
      >
        <p className="text-white/50">
          <Link to="/" className="text-accent-cyan no-underline">
            Sign in
          </Link>{" "}
          to view your route art.
        </p>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "100vh", backgroundColor: "#0f1724" }}
      >
        <p className="text-white/50">Loading routes...</p>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "100vh", backgroundColor: "#0f1724" }}
      >
        <p className="text-red-400">Failed to load routes. Please try again later.</p>
      </div>
    );
  }

  // Empty
  if (routes.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: "100vh", backgroundColor: "#0f1724" }}
      >
        <p className="text-white/50">No routes yet. Go record some activities!</p>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "#0f1724" }}>
      <RouteCanvas routes={routes} />
    </div>
  );
}
