import { useAuth } from "../hooks/useAuth";
import MultiSportComparisonChart from "../components/dashboard/MultiSportComparisonChart";
import NeonSpinner from "../components/NeonSpinner";

/**
 * Dashboard landing page showing multi-sport overview.
 *
 * Works for both authenticated and unauthenticated users:
 * - Authenticated: Shows real data from API
 * - Unauthenticated: Shows fixture/demo data
 *
 * Layout:
 * - Header with welcome message
 * - MultiSportComparisonChart with sparklines and recent activities
 * - Sign-in prompt for unauthenticated users
 */

export default function Dashboard() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        className="container d-flex justify-content-center align-items-center"
        style={{ minHeight: "60vh" }}
      >
        <NeonSpinner />
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      {/* Header Section */}
      <div className="dashboard-header mb-4">
        <h1 className="h2">
          {user ? `Welcome back, ${user.displayName?.split(" ")[0] || "there"}!` : "Welcome!"}
        </h1>
        <p className="text-muted">
          {user
            ? "Your multi-sport activity dashboard"
            : "Sign in to see your personal data, or explore with demo data below."}
        </p>
      </div>

      {/* Multi-Sport Comparison Chart */}
      <MultiSportComparisonChart className="mb-4" />

      {/* Sign-in prompt for unauthenticated users */}
      {!user && (
        <div className="mt-5 text-center">
          <hr className="my-4" />
          <p className="text-muted">
            <strong>Want to see your own data?</strong>
          </p>
          <p className="text-muted small">
            Sign in with Google to connect your Strava activities and track your personal goals.
          </p>
        </div>
      )}
    </div>
  );
}
