import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import MultiSportSparklineChart from "../components/dashboard/MultiSportSparklineChart";
import RecentActivitiesList from "../components/dashboard/RecentActivitiesList";
import TimeRangeSelector from "../components/dashboard/TimeRangeSelector";
import WeeklySummaryCard from "../components/dashboard/WeeklySummaryCard";
import GoalProgressCard from "../components/dashboard/GoalProgressCard";
import ActivityCalendarHeatmap from "../components/dashboard/ActivityCalendarHeatmap";
import DashboardSkeleton from "../components/skeletons/DashboardSkeleton";
import { CardErrorBoundary } from "../components/dashboard/CardErrorBoundary";
import { PageLayout } from "../components/layout/PageLayout";
import type { TuningParams } from "../utils/demoDataGenerator";
import type { TimeRange } from "../utils/dataNormalization";
import { DemoBanner } from "../components/DemoBanner";
import { Section } from "../components/theme/Section";
import DashboardHero from "../components/dashboard/DashboardHero";

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
  const { user, loading } = useAuth();
  const [timeRange, setTimeRange] = useState<TimeRange>("2weeks");

  if (loading) {
    return (
      <PageLayout>
        <DashboardSkeleton />
      </PageLayout>
    );
  }

  const tuningParams = !user ? DASHBOARD_DEMO_TUNING : undefined;

  return (
    <PageLayout>
      {!user && <DemoBanner />}

      <DashboardHero tuningParams={tuningParams} />

      <div className="px-4 md:px-6 py-6 @container">
        {/* Recent activity: chart + list under one time range */}
        <Section
          title="Recent Activity"
          actions={<TimeRangeSelector value={timeRange} onChange={setTimeRange} />}
          className="mb-8"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <CardErrorBoundary>
              <MultiSportSparklineChart timeRange={timeRange} tuningParams={tuningParams} />
            </CardErrorBoundary>
            <CardErrorBoundary>
              <RecentActivitiesList timeRange={timeRange} />
            </CardErrorBoundary>
          </div>
        </Section>

        {/* Weekly Summary + Goal Progress row */}
        <div className="grid grid-cols-1 @md:grid-cols-2 gap-6 mb-8">
          <WeeklySummaryCard />
          <CardErrorBoundary>
            <GoalProgressCard />
          </CardErrorBoundary>
        </div>

        {/* Activity Calendar Heatmap */}
        <CardErrorBoundary>
          <ActivityCalendarHeatmap className="mb-10" tuningParams={tuningParams} />
        </CardErrorBoundary>

        {/* Sign-in prompt for unauthenticated users */}
        {!user && (
          <div className="mt-12 text-center">
            <hr className="my-6" />
            <p className="text-muted-text">
              <strong>Interested in using Desire Lines?</strong>
            </p>
            <p className="text-muted-text text-sm">
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
