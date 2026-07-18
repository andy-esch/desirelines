import { useMemo } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import ActivityTable from "../components/ActivityTable";
import { useActivities } from "../hooks/useActivities";
import { getUserSettings } from "../utils/units";
import { useUserConfig } from "../hooks/useUserConfig";
import { useSportConfig } from "../hooks/useSportConfig";
import { PageLayout } from "../components/layout/PageLayout";
import {
  type TimeRange,
  TIME_RANGE_OPTIONS,
  coerceTimeRange,
  calculateDateRange,
} from "../utils/timeRange";

const FALLBACK_SPORT_OPTIONS = [
  { value: "", label: "All Sports" },
  { value: "cycling", label: "Cycling" },
  { value: "running", label: "Running" },
  { value: "yoga", label: "Yoga" },
];

const ActivitiesPage = () => {
  const search = useSearch({ from: "/activities" });
  const navigate = useNavigate();

  // Load user preferences for unit settings
  const { data: preferences } = useUserConfig("preferences");
  const userSettings = getUserSettings(preferences);

  // Derive sport filter options from config (fallback while loading)
  const { sportConfig } = useSportConfig();
  const sportOptions = useMemo(() => {
    if (!sportConfig) return FALLBACK_SPORT_OPTIONS;
    const options = Object.entries(sportConfig.sportCategories).map(([key, cat]) => ({
      value: key,
      label: cat.displayName,
    }));
    return [{ value: "", label: "All Sports" }, ...options];
  }, [sportConfig]);

  // Derive filter values from URL (single source of truth)
  const selectedRange: TimeRange = coerceTimeRange(search.range, "4w");
  const selectedSport = search.sport || "";

  // Calculate date range based on selection
  const dateRange = useMemo(() => calculateDateRange(selectedRange), [selectedRange]);

  // Build filter for API
  const filter = useMemo(
    () => ({
      from: dateRange.from,
      to: dateRange.to,
      sport: selectedSport || undefined,
      limit: 50,
    }),
    [dateRange.from, dateRange.to, selectedSport]
  );

  const { activities, isLoading, error, hasMore, loadMore, retry } = useActivities(filter);

  // Update URL when filters change (URL is the single source of truth)
  const handleRangeChange = (range: TimeRange) => {
    void navigate({
      to: "/activities",
      search: (prev) => ({ ...prev, range }),
    });
  };

  const handleSportChange = (newSport: string) => {
    void navigate({
      to: "/activities",
      search: (prev) => {
        const { sport: _omit, ...rest } = prev;
        return newSport ? { ...rest, sport: newSport } : rest;
      },
    });
  };

  return (
    <PageLayout background="activities">
      <div className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-3">
          <h1 className="h3 mb-0 font-display">Activities</h1>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-6 mb-6">
          <div className="flex items-center gap-2">
            <label htmlFor="timeRange" className="text-slate-light text-sm mb-0">
              Time:
            </label>
            <select
              id="timeRange"
              className="form-select form-select-sm"
              value={selectedRange}
              onChange={(e) => handleRangeChange(e.target.value as TimeRange)}
              style={{ width: "auto" }}
            >
              {TIME_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sportFilter" className="text-slate-light text-sm mb-0">
              Sport:
            </label>
            <select
              id="sportFilter"
              className="form-select form-select-sm"
              value={selectedSport}
              onChange={(e) => handleSportChange(e.target.value)}
              style={{ width: "auto" }}
            >
              {sportOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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
        />
      </div>
    </PageLayout>
  );
};

export default ActivitiesPage;
