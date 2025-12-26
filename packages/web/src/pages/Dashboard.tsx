import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

/**
 * Dashboard landing page showing multi-sport overview.
 *
 * Works for both authenticated and unauthenticated users:
 * - Authenticated: Shows real data from API
 * - Unauthenticated: Shows fixture/demo data
 *
 * Phase 1: Basic structure with placeholders
 * Phase 2: Add MultiSportComparisonChart
 * Phase 3: Add SportCards with mini-charts
 * Phase 4: Polish and integration
 */

const SPORTS = ["cycling", "running", "yoga"] as const;
type Sport = (typeof SPORTS)[number];

const SPORT_INFO: Record<Sport, { icon: string; color: string }> = {
  cycling: { icon: "\u{1F6B2}", color: "#3b82f6" },
  running: { icon: "\u{1F3C3}", color: "#10b981" },
  yoga: { icon: "\u{1F9D8}", color: "#8b5cf6" },
};

export default function Dashboard() {
  const { user, loading } = useAuth();
  const currentYear = new Date().getFullYear();

  if (loading) {
    return (
      <div
        className="container d-flex justify-content-center align-items-center"
        style={{ minHeight: "60vh" }}
      >
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
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

      {/* Multi-Sport Comparison Chart Section (Phase 2) */}
      <div className="comparison-chart-section mb-5">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="h4 mb-0">Recent Activity</h2>
          {/* Time range selector will go here in Phase 2 */}
        </div>
        <div
          className="chart-placeholder bg-light rounded p-5 text-center"
          style={{ minHeight: "200px" }}
        >
          <p className="text-muted mb-0">
            <em>Multi-sport comparison chart coming soon</em>
          </p>
          <small className="text-muted">
            Overlapping sparklines showing performance across all sports
          </small>
        </div>
      </div>

      {/* Sport Cards Section (Phase 3) */}
      <div className="sport-cards-section">
        <h2 className="h4 mb-3">Your Sports</h2>
        <div className="row g-4">
          {SPORTS.map((sport) => {
            const info = SPORT_INFO[sport];
            return (
              <div key={sport} className="col-md-4">
                <div className="card h-100 shadow-sm">
                  <div className="card-body">
                    <div className="d-flex align-items-center mb-3">
                      <span style={{ fontSize: "1.5rem" }} className="me-2">
                        {info.icon}
                      </span>
                      <h5 className="card-title mb-0 text-capitalize">{sport}</h5>
                    </div>

                    {/* Mini sparkline placeholder (Phase 3) */}
                    <div
                      className="sparkline-placeholder bg-light rounded mb-3"
                      style={{ height: "60px" }}
                    />

                    {/* Goal progress placeholder (Phase 3) */}
                    <p className="text-muted small mb-3">
                      <em>Goal progress summary coming soon</em>
                    </p>

                    <Link to={`/${sport}/${currentYear}`} className="btn btn-outline-primary w-100">
                      View Details
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

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
