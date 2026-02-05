import React, { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import ActivityTable from "../components/ActivityTable";
import { useActivities } from "../hooks/useActivities";
import { DEFAULT_USER_SETTINGS, type DistanceUnit, type ElevationUnit } from "../utils/units";
import { pageBackgrounds } from "../styles/pageBackgrounds";

type TimeRange = "2w" | "4w" | "2m" | "6m" | "ytd" | "all";

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "2w", label: "2 Weeks" },
  { value: "4w", label: "4 Weeks" },
  { value: "2m", label: "2 Months" },
  { value: "6m", label: "6 Months" },
  { value: "ytd", label: "Year to Date" },
  { value: "all", label: "All Time" },
];

const SPORT_OPTIONS = [
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

const ActivitiesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Get filter values from URL or defaults
  const timeRange = (searchParams.get("range") as TimeRange) || "4w";
  const sport = searchParams.get("sport") || "";

  // Local state for filter controls
  const [selectedRange, setSelectedRange] = useState<TimeRange>(timeRange);
  const [selectedSport, setSelectedSport] = useState(sport);

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

  // Update URL when filters change
  const handleRangeChange = (range: TimeRange) => {
    setSelectedRange(range);
    const params = new URLSearchParams(searchParams);
    params.set("range", range);
    setSearchParams(params);
  };

  const handleSportChange = (newSport: string) => {
    setSelectedSport(newSport);
    const params = new URLSearchParams(searchParams);
    if (newSport) {
      params.set("sport", newSport);
    } else {
      params.delete("sport");
    }
    setSearchParams(params);
  };

  return (
    <div className="flex-grow-1" style={{ background: pageBackgrounds.activities }}>
      <div className="container-fluid py-4">
        {/* Header */}
        <div className="row mb-3">
          <div className="col">
            <h1 className="h3 mb-0">Activities</h1>
          </div>
        </div>

        {/* Filters */}
        <div className="d-flex align-items-center gap-3 mb-4">
          <div className="d-flex align-items-center gap-2">
            <label htmlFor="timeRange" className="text-muted small mb-0">
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

          <div className="d-flex align-items-center gap-2">
            <label htmlFor="sportFilter" className="text-muted small mb-0">
              Sport:
            </label>
            <select
              id="sportFilter"
              className="form-select form-select-sm"
              value={selectedSport}
              onChange={(e) => handleSportChange(e.target.value)}
              style={{ width: "auto" }}
            >
              {SPORT_OPTIONS.map((option) => (
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
          distanceUnit={DEFAULT_USER_SETTINGS.distanceUnit as DistanceUnit}
          elevationUnit={DEFAULT_USER_SETTINGS.elevationUnit as ElevationUnit}
        />
      </div>
    </div>
  );
};

export default ActivitiesPage;
