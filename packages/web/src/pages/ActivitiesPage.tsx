import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import ActivityTable from "../components/ActivityTable";
import { useActivities } from "../hooks/useActivities";
import { getUserSettings } from "../utils/units";
import { useUserConfig } from "../hooks/useUserConfig";
import { useSportConfig } from "../hooks/useSportConfig";
import { PageLayout } from "../components/layout/PageLayout";

type TimeRange = "2w" | "4w" | "2m" | "6m" | "ytd" | "all";

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "2w", label: "2 Weeks" },
  { value: "4w", label: "4 Weeks" },
  { value: "2m", label: "2 Months" },
  { value: "6m", label: "6 Months" },
  { value: "ytd", label: "Year to Date" },
  { value: "all", label: "All Time" },
];

const FALLBACK_SPORT_OPTIONS = [
  { value: "", label: "All Sports" },
  { value: "cycling", label: "Cycling" },
  { value: "running", label: "Running" },
  { value: "yoga", label: "Yoga" },
];

function calculateDateRange(range: TimeRange): { from?: string; to?: string } {
  const today = new Date();
  const toDate = today.toISOString().split("T")[0];

  switch (range) {
    case "2w": {
      const from = new Date(today);
      from.setDate(from.getDate() - 14);
      return { from: from.toISOString().split("T")[0], to: toDate };
    }
    case "4w": {
      const from = new Date(today);
      from.setDate(from.getDate() - 28);
      return { from: from.toISOString().split("T")[0], to: toDate };
    }
    case "2m": {
      const from = new Date(today);
      from.setDate(from.getDate() - 60);
      return { from: from.toISOString().split("T")[0], to: toDate };
    }
    case "6m": {
      const from = new Date(today);
      from.setDate(from.getDate() - 180);
      return { from: from.toISOString().split("T")[0], to: toDate };
    }
    case "ytd": {
      const from = new Date(today.getFullYear(), 0, 1);
      return { from: from.toISOString().split("T")[0], to: toDate };
    }
    case "all":
    default:
      return {};
  }
}

const VALID_RANGES: TimeRange[] = ["2w", "4w", "2m", "6m", "ytd", "all"];

const ActivitiesPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Load user preferences for unit settings
  const { data: preferences } = useUserConfig("preferences");
  const userSettings = getUserSettings(preferences);

  // Derive sport filter options from config (fallback while loading)
  const { sportConfig } = useSportConfig();
  const sportOptions = useMemo(() => {
    if (!sportConfig) return FALLBACK_SPORT_OPTIONS;
    const options = Object.entries(sportConfig.sport_categories).map(([key, cat]) => ({
      value: key,
      label: cat.display_name,
    }));
    return [{ value: "", label: "All Sports" }, ...options];
  }, [sportConfig]);

  // Derive filter values from URL (single source of truth)
  const rangeParam = searchParams.get("range");
  const selectedRange: TimeRange = VALID_RANGES.includes(rangeParam as TimeRange)
    ? (rangeParam as TimeRange)
    : "4w";
  const selectedSport = searchParams.get("sport") || "";

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
    const params = new URLSearchParams(searchParams);
    params.set("range", range);
    setSearchParams(params);
  };

  const handleSportChange = (newSport: string) => {
    const params = new URLSearchParams(searchParams);
    if (newSport) {
      params.set("sport", newSport);
    } else {
      params.delete("sport");
    }
    setSearchParams(params);
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
          distanceUnit={userSettings.distanceUnit}
          elevationUnit={userSettings.elevationUnit}
        />
      </div>
    </PageLayout>
  );
};

export default ActivitiesPage;
