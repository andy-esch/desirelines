import { useMemo } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import ActivityTable from "../components/ActivityTable";
import { useActivities } from "../hooks/useActivities";
import { getUserSettings } from "../utils/units";
import { useUserConfig } from "../hooks/useUserConfig";
import { useSportOptions } from "../hooks/useSportOptions";
import { useVisibleSports } from "../hooks/useVisibleSports";
import { useDashboardGoalData } from "../hooks/useDashboardGoalData";
import { PageLayout } from "../components/layout/PageLayout";
import ActiveFilterPill, { activeFilterLabels } from "../components/ActiveFilterPill";
import SportFilterPills from "../components/SportFilterPills";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "../components/ui/select";
import {
  type TimeRange,
  TIME_RANGE_OPTIONS,
  coerceTimeRange,
  calculateDateRange,
} from "../utils/timeRange";
import { normalizeSports } from "../utils/sportConfig";

// List opens on the last 4 weeks. Single source so the URL fallback and the pill's
// "is a filter active?" logic can't drift apart.
// Deliberately different from ChartsPage's "ytd". This is a recent-activity
// list, where the useful default is the last few weeks rather than the year so
// far. The divergence is intentional — don't "fix" it by aligning.
const DEFAULT_RANGE: TimeRange = "4w";

const ActivitiesPage = () => {
  const search = useSearch({ from: "/activities" });
  const navigate = useNavigate();

  // Load user preferences for unit settings
  const { data: preferences } = useUserConfig("preferences");
  const userSettings = getUserSettings(preferences);

  const sportOptions = useSportOptions();
  const { visibleSports } = useVisibleSports();

  // Derive filter values from URL (single source of truth). `sports` is the shared
  // param name across the Activities-group views; normalized so equivalent
  // selections share one URL, queryKey, and cache entry.
  const selectedRange: TimeRange = coerceTimeRange(search.range, DEFAULT_RANGE);
  const selectedSports = useMemo(
    () => normalizeSports(search.sports?.split(",") ?? []),
    [search.sports]
  );

  // Impact % is measured against one sport's goal, so the column only appears
  // under a single-sport filter. With no filter (or several sports) every row
  // would need its own goal and the one column cannot say which it used — the
  // per-row Sport badge already carries that distinction.
  //
  // Held back until the goals resolve: transformToSportGoalData seeds impactGoal
  // from metricConfig.defaultGoalValue (dashboardUtils.ts:79) rather than zero,
  // so an unguarded render shows percentages measured against 2,500 mi and then
  // silently restates them against the athlete's real goal.
  const { sportData, isLoading: goalsLoading } = useDashboardGoalData();
  const goalData = useMemo(
    () =>
      !goalsLoading && selectedSports.length === 1
        ? sportData.find((g) => g.sport === selectedSports[0])
        : undefined,
    [goalsLoading, sportData, selectedSports]
  );

  // Calculate date range based on selection
  const dateRange = useMemo(() => calculateDateRange(selectedRange), [selectedRange]);

  // Build filter for API
  const filter = useMemo(
    () => ({
      from: dateRange.from,
      to: dateRange.to,
      sports: selectedSports,
      limit: 50,
    }),
    [dateRange.from, dateRange.to, selectedSports]
  );

  const { activities, isLoading, error, hasMore, loadMore, retry } = useActivities(filter);

  // Update URL when filters change (URL is the single source of truth). The
  // callbacks pick this route's own params rather than spreading `prev`, whose
  // type is the cross-route union including params this route strips.
  const handleRangeChange = (range: TimeRange) => {
    void navigate({
      to: "/activities",
      search: (prev) => ({ range, sports: prev.sports }),
    });
  };

  const handleSportsChange = (newSports: string[]) => {
    const normalized = normalizeSports(newSports);
    void navigate({
      to: "/activities",
      search: (prev) =>
        normalized.length
          ? { range: prev.range, sports: normalized.join(",") }
          : { range: prev.range },
    });
  };

  // Active, non-default filters (range ≠ the 4w default, or selected sports) drive the
  // floating pill so a left-over/bookmarked filter never reads as missing data.
  const activeFilters = useMemo(
    () =>
      activeFilterLabels(
        selectedRange,
        DEFAULT_RANGE,
        selectedSports,
        TIME_RANGE_OPTIONS,
        sportOptions
      ),
    [selectedRange, selectedSports, sportOptions]
  );
  const clearFilters = () => void navigate({ to: "/activities", search: {} });

  return (
    <PageLayout background="activities">
      <ActiveFilterPill filters={activeFilters} onClear={clearFilters} />
      <div className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-3">
          <h1 className="h3 mb-0 font-display">Activities</h1>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-6">
          <div className="flex items-center gap-2">
            <span id="activitiesTimeLabel" className="text-slate-light text-sm">
              Time:
            </span>
            <Select
              value={selectedRange}
              onValueChange={(v) => handleRangeChange(coerceTimeRange(v, DEFAULT_RANGE))}
            >
              <SelectTrigger aria-labelledby="activitiesTimeLabel" className="w-auto">
                <SelectValue>
                  {(v) => TIME_RANGE_OPTIONS.find((o) => o.value === v)?.label ?? ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span id="activitiesSportLabel" className="text-slate-light text-sm">
              Sport:
            </span>
            <SportFilterPills
              sportOptions={sportOptions}
              visibleSports={visibleSports}
              selected={selectedSports}
              onChange={handleSportsChange}
              labelledBy="activitiesSportLabel"
            />
          </div>
        </div>

        {/* Activity Table */}
        <ActivityTable
          activities={activities}
          isLoading={isLoading}
          error={error}
          hasMore={hasMore}
          onLoadMore={loadMore}
          onRetry={retry}
          onViewOnMap={(id) => void navigate({ to: "/routes", search: { activity: Number(id) } })}
          distanceUnit={userSettings.distanceUnit}
          elevationUnit={userSettings.elevationUnit}
          {...(goalData
            ? {
                goalTarget: goalData.impactGoal,
                isSessionSport: goalData.metricType === "sessions",
                // Name impactGoal, not targetGoal: the percentage above is a
                // share of impactGoal, and impactGoalLabel is *its* label — the
                // two are a pair. Rounded like the dashboard's equivalent
                // tooltip (RecentActivitiesList.tsx:310) since the converted
                // value carries fractions. The label is the athlete's own and
                // may be empty (dashboardUtils.ts:100), so the parenthetical is
                // dropped rather than rendered as "3,000 mi () goal".
                goalLabel: goalData.impactGoalLabel
                  ? `${Math.round(goalData.impactGoal).toLocaleString()} ${goalData.metricUnit} (${goalData.impactGoalLabel})`
                  : `${Math.round(goalData.impactGoal).toLocaleString()} ${goalData.metricUnit}`,
              }
            : {})}
        />
      </div>
    </PageLayout>
  );
};

export default ActivitiesPage;
