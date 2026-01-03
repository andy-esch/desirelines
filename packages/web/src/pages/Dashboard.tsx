import { useAuth } from "../hooks/useAuth";
import MultiSportComparisonChart from "../components/dashboard/MultiSportComparisonChart";
import NeonSpinner from "../components/NeonSpinner";
import { pageBackgrounds } from "../styles/pageBackgrounds";

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
      <div className="flex-grow-1" style={{ background: pageBackgrounds.dashboard }}>
        <div
          className="container d-flex justify-content-center align-items-center"
          style={{ minHeight: "60vh" }}
        >
          <NeonSpinner />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-grow-1" style={{ background: pageBackgrounds.dashboard }}>
      {/* Demo mode banner for unauthenticated users */}
      {!user && (
        <div className="alert alert-demo mb-0 rounded-0" role="alert">
          <div className="container-fluid">
            <strong>Demo Mode</strong> - Viewing generated sample data.{" "}
            <span className="text-muted small">Sign-in is invite-only.</span>
          </div>
        </div>
      )}

      <div className="container-fluid py-4">
        {/* Header Section */}
        <div className="dashboard-header mb-4">
          <h1 className="h2">
            {user ? `Welcome back, ${user.displayName?.split(" ")[0] || "there"}!` : "Welcome!"}
          </h1>
          <p className="text-muted">
            {user
              ? "Your multi-sport activity dashboard"
              : "Explore the dashboard with demo data, then sign in to see your own activities."}
          </p>
        </div>

        {/* Multi-Sport Comparison Chart */}
        <MultiSportComparisonChart className="mb-4" />

        {/* Sign-in prompt for unauthenticated users */}
        {!user && (
          <div className="mt-5 text-center">
            <hr className="my-4" />
            <p className="text-muted">
              <strong>Interested in using Desire Lines?</strong>
            </p>
            <p className="text-muted small">
              Sign-in is currently invite-only.
              <br />
              Check back soon or reach out if you'd like early access.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
