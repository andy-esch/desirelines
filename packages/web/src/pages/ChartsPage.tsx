import { useMemo, useState } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { PageLayout } from "../components/layout/PageLayout";
import ChartContainer from "../components/charts/ChartContainer";
import MetricSelector from "../components/charts/MetricSelector";
import ActivityVolumeChart from "../components/charts/ActivityVolumeChart";
import ActiveFilterPill, { activeFilterLabels } from "../components/ActiveFilterPill";
import SportFilterPills from "../components/SportFilterPills";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "../components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { useAllActivities } from "../hooks/useAllActivities";
import { useSportConfig } from "../hooks/useSportConfig";
import { useUserConfig } from "../hooks/useUserConfig";
import { useVisibleSports } from "../hooks/useVisibleSports";
import {
  aggregateActivities,
  toChartData,
  filterBucketsByType,
  monthsInRange,
  type BucketMetric,
  type ActivityTypeFilter,
  type ChartRow,
} from "../utils/activityBuckets";
import {
  type TimeRange,
  TIME_RANGE_OPTIONS,
  coerceTimeRange,
  calculateDateRange,
} from "../utils/timeRange";
import {
  getUserSettings,
  convertDistance,
  getDistanceLabel,
  formatHoursMinutes,
} from "../utils/units";

const FALLBACK_SPORT_OPTIONS = [
  { value: "", label: "All Sports" },
  { value: "cycling", label: "Cycling" },
  { value: "running", label: "Running" },
  { value: "yoga", label: "Yoga" },
];

// Charts opens on year-to-date (more history than the table's 4w). Single source so the
// URL fallback and the "is a filter active?" pill logic can't drift apart.
const DEFAULT_RANGE: TimeRange = "ytd";

// MetricSelector labels via getMetricDisplayLabel, which only maps the API metric
// keys — so use those (not "distance"/"time"/"sessions", which fall through to raw
// lowercase labels) and map each to its bucket measure.
const METRIC_IDS = ["distance_meters", "time_minutes", "activities"] as const;
type MetricId = (typeof METRIC_IDS)[number];
const METRIC_ID_TO_BUCKET: Record<MetricId, BucketMetric> = {
  distance_meters: "distanceMeters",
  time_minutes: "movingTimeSeconds",
  activities: "count",
};

const TYPE_OPTIONS: { value: ActivityTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "outdoor", label: "Outdoor" },
  { value: "indoor", label: "Indoor / Virtual" },
];

export default function ChartsPage() {
  const search = useSearch({ from: "/charts" });
  const navigate = useNavigate();

  const { data: preferences } = useUserConfig("preferences");
  const userSettings = getUserSettings(preferences);
  const { sportConfig } = useSportConfig();
  const { visibleSports } = useVisibleSports();

  const sportOptions = useMemo(() => {
    if (!sportConfig) return FALLBACK_SPORT_OPTIONS;
    const options = Object.entries(sportConfig.sportCategories).map(([key, cat]) => ({
      value: key,
      label: cat.displayName,
    }));
    return [{ value: "", label: "All Sports" }, ...options];
  }, [sportConfig]);

  // URL is the source of truth for the shared Activities-group filters. `sports` is the
  // shared param name (plural, matching the map); this single-select view uses the first.
  const selectedRange: TimeRange = coerceTimeRange(search.range, DEFAULT_RANGE);
  const selectedSport = search.sports?.split(",")[0] ?? "";
  const [metricId, setMetricId] = useState<MetricId>("distance_meters");
  const [typeFilter, setTypeFilter] = useState<ActivityTypeFilter>("all");
  const metric = METRIC_ID_TO_BUCKET[metricId];

  const dateRange = useMemo(() => calculateDateRange(selectedRange), [selectedRange]);
  const filter = useMemo(
    () => ({ from: dateRange.from, to: dateRange.to, sport: selectedSport || undefined }),
    [dateRange.from, dateRange.to, selectedSport]
  );

  const { activities, isLoading, error, retry } = useAllActivities(filter);

  // All buckets for the range+sport (before the geography filter) — this drives
  // the reconciliation caption so it always shows the full outdoor/indoor split.
  const buckets = useMemo(() => aggregateActivities(activities), [activities]);

  // The continuous month axis for the selected range, so empty months still show.
  const monthAxis = useMemo(
    () => monthsInRange(dateRange.from, dateRange.to),
    [dateRange.from, dateRange.to]
  );

  const chartData = useMemo(
    () => toChartData(filterBucketsByType(buckets, typeFilter), metric, monthAxis),
    [buckets, typeFilter, metric, monthAxis]
  );

  // Convert raw bucket measures (meters / seconds / count) into the user's display
  // units (mi·km / hours / count) IN THE DATA, so the Y-axis plots display values.
  // With integer ticks that keeps small ranges clean — otherwise recharts places
  // ticks in raw units and the formatter rounds them into duplicates (a 1-session
  // month → [0,0,0,1,1]; an all-zero metric → [0,0,0,0,0]).
  const displayData = useMemo(() => {
    const toDisplay = (raw: number): number => {
      switch (metric) {
        case "distanceMeters":
          return convertDistance(raw, userSettings.distanceUnit);
        case "movingTimeSeconds":
          return raw / 3600;
        case "count":
          return raw;
      }
    };
    const rows: ChartRow[] = chartData.rows.map((row) => {
      const out: ChartRow = { month: row.month };
      for (const s of chartData.series) out[s.key] = toDisplay(row[s.key] as number);
      return out;
    });
    return { rows, series: chartData.series };
  }, [chartData, metric, userSettings.distanceUnit]);

  const { geoCount, indoorCount } = useMemo(() => {
    let geo = 0;
    let indoor = 0;
    for (const b of buckets) {
      if (b.geographic) geo += b.count;
      else indoor += b.count;
    }
    return { geoCount: geo, indoorCount: indoor };
  }, [buckets]);

  // Values are already in display units (unit lives in the axis label). Show up to
  // one decimal so a continuous metric's fractional ticks (0.5 hr, 2.5 mi) read
  // correctly; counts are integer ticks and format as whole numbers anyway.
  const formatAxisValue = (v: number): string =>
    v.toLocaleString(undefined, { maximumFractionDigits: 1 });

  // Tooltip carries the unit, since it has no axis-label context.
  const formatTooltipValue = (v: number): string => {
    switch (metric) {
      case "distanceMeters":
        return `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${getDistanceLabel(userSettings.distanceUnit)}`;
      case "movingTimeSeconds":
        return formatHoursMinutes(v);
      case "count":
        return v === 1 ? "1 activity" : `${v} activities`;
    }
  };

  const metricLabel: string = {
    distanceMeters: `Distance (${getDistanceLabel(userSettings.distanceUnit)})`,
    movingTimeSeconds: "Time (hr)",
    count: "Activities",
  }[metric];

  const setSearch = (patch: { range?: TimeRange; sports?: string }) => {
    void navigate({
      to: "/charts",
      search: (prev) => {
        const next = { ...prev, ...patch };
        if (!next.sports) delete next.sports; // strip empty ?sports= (All Sports) from the URL
        return next;
      },
    });
  };

  // Active, non-default filters (range ≠ the ytd default, or a specific sport) drive the
  // floating pill so a left-over/bookmarked filter never reads as missing data.
  const activeFilters = useMemo(
    () =>
      activeFilterLabels(
        selectedRange,
        DEFAULT_RANGE,
        selectedSport,
        TIME_RANGE_OPTIONS,
        sportOptions
      ),
    [selectedRange, selectedSport, sportOptions]
  );
  const clearFilters = () => void navigate({ to: "/charts", search: {} });

  return (
    <PageLayout background="activities">
      <ActiveFilterPill filters={activeFilters} onClear={clearFilters} />
      <div className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        <div className="mb-3">
          <h1 className="h3 mb-0 font-display">Charts</h1>
          <p className="text-slate-light text-sm mt-1">
            Every activity — including the indoor and virtual workouts that don’t appear on the map.
          </p>
        </div>

        {/* Shared range + sport filters, plus the type + metric toggles. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-6">
          <div className="flex items-center gap-2">
            <span id="chartsTimeLabel" className="text-slate-light text-sm">
              Time:
            </span>
            <Select
              value={selectedRange}
              onValueChange={(v) => setSearch({ range: coerceTimeRange(v, DEFAULT_RANGE) })}
            >
              <SelectTrigger aria-labelledby="chartsTimeLabel" className="w-auto">
                <SelectValue>
                  {(v) => TIME_RANGE_OPTIONS.find((o) => o.value === v)?.label ?? ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span id="chartsSportLabel" className="text-slate-light text-sm">
              Sport:
            </span>
            <SportFilterPills
              sportOptions={sportOptions}
              visibleSports={visibleSports}
              selected={selectedSport}
              onChange={(s) => setSearch({ sports: s })}
              labelledBy="chartsSportLabel"
            />
          </div>

          <ToggleGroup
            value={[typeFilter]}
            onValueChange={(vals) => {
              const v = vals[0];
              if (v) setTypeFilter(v as ActivityTypeFilter); // a type is always active
            }}
            aria-label="Filter by activity type"
          >
            {TYPE_OPTIONS.map((o) => (
              <ToggleGroupItem key={o.value} value={o.value}>
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <MetricSelector
            availableMetrics={[...METRIC_IDS]}
            selectedMetric={metricId}
            onMetricChange={(id) => setMetricId(id as MetricId)}
          />
        </div>

        <ChartContainer
          title="Activity volume"
          hideHeader
          isLoading={isLoading}
          error={error}
          // Empty only when there are no activities at all in the range+sport. A
          // type filter that removes everything still renders the month axis + the
          // caption (which explains the outdoor/indoor split), rather than an
          // empty state that hides that context.
          isEmpty={buckets.length === 0}
          onRetry={retry}
          emptyStateConfig={{
            message: "No activities in this range. Try a wider time range or a different sport.",
          }}
        >
          <ActivityVolumeChart
            data={displayData}
            sportConfig={sportConfig}
            formatAxisValue={formatAxisValue}
            formatTooltipValue={formatTooltipValue}
            metricLabel={metricLabel}
            // count is discrete → integer ticks; distance/time are continuous.
            allowDecimals={metric !== "count"}
          />
          <p className="mt-3 text-xs text-slate-light">
            {geoCount.toLocaleString()} outdoor · {indoorCount.toLocaleString()} indoor / virtual
            {typeFilter !== "all" && chartData.series.length === 0 && (
              <span>
                {" "}
                — no {typeFilter === "outdoor" ? "outdoor" : "indoor / virtual"} activities in this
                range
              </span>
            )}
          </p>
        </ChartContainer>
      </div>
    </PageLayout>
  );
}
