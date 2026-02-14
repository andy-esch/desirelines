import { useAuth } from "../hooks/useAuth";
import MultiSportComparisonChart from "../components/dashboard/MultiSportComparisonChart";
import WeeklySummaryCard from "../components/dashboard/WeeklySummaryCard";
import GoalProgressCard from "../components/dashboard/GoalProgressCard";
import ActivityCalendarHeatmap from "../components/dashboard/ActivityCalendarHeatmap";
import NeonSpinner from "../components/NeonSpinner";
import { PageLayout } from "../components/layout/PageLayout";
import type { TuningParams } from "../utils/demoDataGenerator";

/**
 * Dashboard landing page showing multi-sport overview.
 *
 * Works for both authenticated and unauthenticated users:
 * - Authenticated: Shows real data from API
 * - Unauthenticated: Shows demo data
 *
 * Layout:
 * - Header with welcome message
 * - MultiSportComparisonChart with sparklines and recent activities
 * - Sign-in prompt for unauthenticated users
 */

/**
 * Calibrated demo tuning for the dashboard view.
 * Scales each sport's configured activitiesPerWeek by 0.7x and uses
 * "low" consistency sigmas to produce a natural-looking heatmap.
 * See DEMO_DATA.md for details on changing these values.
 */
const DASHBOARD_DEMO_TUNING: TuningParams = {
  activitiesPerWeekMultiplier: 0.7,
  distanceSigma: 0.6,
  durationSigma: 0.5,
};

export default function Dashboard() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <PageLayout background="dashboard">
        <div
          className="container d-flex justify-content-center align-items-center"
          style={{ minHeight: "60vh" }}
        >
          <NeonSpinner />
        </div>
      </PageLayout>
    );
  }

  const tuningParams = !user ? DASHBOARD_DEMO_TUNING : undefined;

  return (
    <PageLayout background="dashboard">
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
        <MultiSportComparisonChart className="mb-4" tuningParams={tuningParams} />

        {/* Weekly Summary + Goal Progress row */}
        <div className="row g-3 mb-4">
          <div className="col-md-6">
            <WeeklySummaryCard />
          </div>
          <div className="col-md-6">
            <GoalProgressCard />
          </div>
        </div>

        {/* Activity Calendar Heatmap */}
        <ActivityCalendarHeatmap className="mb-4" tuningParams={tuningParams} />

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
    </PageLayout>
  );
}
