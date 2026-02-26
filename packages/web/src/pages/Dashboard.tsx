import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useUserProfile } from "../hooks/useUserProfile";
import { ErrorBoundary } from "react-error-boundary";
import MultiSportSparklineChart from "../components/dashboard/MultiSportSparklineChart";
import RecentActivitiesListCard from "../components/dashboard/RecentActivitiesListCard";
import TimeRangeSelector from "../components/dashboard/TimeRangeSelector";
import WeeklySummaryCard from "../components/dashboard/WeeklySummaryCard";
import GoalProgressCard from "../components/dashboard/GoalProgressCard";
import ActivityCalendarHeatmap from "../components/dashboard/ActivityCalendarHeatmap";
import DashboardSkeleton from "../components/skeletons/DashboardSkeleton";
import ErrorChart from "../components/charts/ErrorChart";
import { PageLayout } from "../components/layout/PageLayout";
import type { TuningParams } from "../utils/demoDataGenerator";
import type { TimeRange } from "../utils/dataNormalization";

/**
 * Dashboard landing page showing multi-sport overview.
 *
 * Works for both authenticated and unauthenticated users:
 * - Authenticated: Shows real data from API
 * - Unauthenticated: Shows demo data
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
  const { user, loading: authLoading } = useAuth();
  const { displayName, loading: profileLoading } = useUserProfile();
  const [timeRange, setTimeRange] = useState<TimeRange>("2weeks");

  const loading = authLoading || (!!user && profileLoading);

  if (loading) {
    return (
      <PageLayout background="dashboard">
        <DashboardSkeleton />
      </PageLayout>
    );
  }

  const tuningParams = !user ? DASHBOARD_DEMO_TUNING : undefined;

  return (
    <PageLayout background="dashboard">
      {/* Demo mode banner for unauthenticated users */}
      {!user && (
        <div className="alert alert-demo mb-0 rounded-none py-3" role="alert">
          <div className="px-4 md:px-6">
            <strong className="text-accent-cyan">Demo Mode</strong>
            <span className="mx-2">—</span>
            Viewing generated sample data.{" "}
            <span className="text-slate text-sm">Sign-in is invite-only.</span>
          </div>
        </div>
      )}

      <div className="px-4 md:px-6 py-6 @container">
        {/* Header Section */}
        <div className="dashboard-header mb-3">
          <h1 className="h2 font-display">
            {user ? `Welcome back, ${displayName.split(" ")[0]}!` : "Welcome!"}
          </h1>
          <p className="text-slate-light">
            {user
              ? "Your multi-sport activity dashboard"
              : "Explore the dashboard with demo data, then sign in to see your own activities."}
          </p>
        </div>

        {/* Recent Activity Header with Time Selector */}
        <div className="flex justify-between items-center mb-3">
          <h2 className="h5 mb-0">Recent Activity</h2>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>

        {/* Main Activity Row: Chart + List */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <ErrorBoundary fallbackRender={({ error }) => <ErrorChart error={error as Error} />}>
            <MultiSportSparklineChart timeRange={timeRange} tuningParams={tuningParams} />
          </ErrorBoundary>
          <ErrorBoundary fallbackRender={({ error }) => <ErrorChart error={error as Error} />}>
            <RecentActivitiesListCard timeRange={timeRange} />
          </ErrorBoundary>
        </div>

        {/* Weekly Summary + Goal Progress row */}
        <div className="grid grid-cols-1 @md:grid-cols-2 gap-6 mb-8">
          <WeeklySummaryCard />
          <ErrorBoundary fallbackRender={({ error }) => <ErrorChart error={error as Error} />}>
            <GoalProgressCard />
          </ErrorBoundary>
        </div>

        {/* Activity Calendar Heatmap */}
        <ErrorBoundary fallbackRender={({ error }) => <ErrorChart error={error as Error} />}>
          <ActivityCalendarHeatmap className="mb-10" tuningParams={tuningParams} />
        </ErrorBoundary>

        {/* Sign-in prompt for unauthenticated users */}
        {!user && (
          <div className="mt-12 text-center">
            <hr className="my-6" />
            <p className="text-slate-light">
              <strong>Interested in using Desire Lines?</strong>
            </p>
            <p className="text-slate-light text-sm">
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
