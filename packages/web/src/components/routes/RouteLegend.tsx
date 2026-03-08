import { useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { getColorForSport } from "./RouteCanvas";
import type { DistanceUnit } from "../../utils/units";
import { convertDistance, getDistanceLabel } from "../../utils/units";
import { ChevronDownIcon } from "../icons";

interface SportInfo {
  sport: string;
  count: number;
}

interface RouteLegendProps {
  /** All sports present in the dataset, with counts for the current filter state */
  sports: SportInfo[];
  /** All years present in the dataset */
  years: number[];
  /** Currently enabled sports */
  enabledSports: Set<string>;
  /** Currently enabled years */
  enabledYears: Set<number>;
  /** Total routes currently shown */
  shownCount: number;
  /** Total distance of shown routes (meters) */
  shownDistanceMeters: number;
  /** True if the fetched routes hit the backend limit */
  atLimit: boolean;
  /** Limit value from the backend */
  limit: number;
  distanceUnit: DistanceUnit;
  onToggleSport: (sport: string) => void;
  onToggleYear: (year: number) => void;
  onToggleAllSports: (enabled: boolean) => void;
  onToggleAllYears: (enabled: boolean) => void;
  onSaveImage: () => void;
}

function SportPill({
  sport,
  count,
  enabled,
  isDark,
  onToggle,
}: {
  sport: string;
  count: number;
  enabled: boolean;
  isDark: boolean;
  onToggle: () => void;
}) {
  const rgb = getColorForSport(sport, isDark);
  const displayName = sport.charAt(0).toUpperCase() + sport.slice(1);

  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs transition-opacity"
      style={{
        opacity: enabled ? 1 : 0.35,
        border: `1px solid rgba(${rgb}, ${enabled ? 0.6 : 0.2})`,
        background: enabled ? `rgba(${rgb}, 0.12)` : "transparent",
        color: isDark ? `rgb(${rgb})` : `rgb(${rgb})`,
      }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ background: `rgb(${rgb})` }}
      />
      {displayName}
      <span style={{ opacity: 0.6 }}>{count}</span>
    </button>
  );
}

function YearPill({
  year,
  enabled,
  onToggle,
}: {
  year: number;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`px-2 py-0.5 rounded-full text-xs transition-opacity border ${
        enabled
          ? "border-slate-light/40 text-body-text bg-surface-hover"
          : "border-transparent text-slate-light/50 bg-transparent"
      }`}
      style={{ opacity: enabled ? 1 : 0.4 }}
    >
      {year}
    </button>
  );
}

export default function RouteLegend({
  sports,
  years,
  enabledSports,
  enabledYears,
  shownCount,
  shownDistanceMeters,
  atLimit,
  limit,
  distanceUnit,
  onToggleSport,
  onToggleYear,
  onToggleAllSports,
  onToggleAllYears,
  onSaveImage,
}: RouteLegendProps) {
  const [expanded, setExpanded] = useState(true);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const allSportsEnabled = sports.every((s) => enabledSports.has(s.sport));
  const allYearsEnabled = years.every((y) => enabledYears.has(y));

  const distanceValue = convertDistance(shownDistanceMeters, distanceUnit);
  const distanceLabel = getDistanceLabel(distanceUnit);
  const formattedDistance =
    distanceValue >= 100 ? Math.round(distanceValue).toLocaleString() : distanceValue.toFixed(1);

  const yearRange =
    years.length > 0
      ? years[years.length - 1] === years[0]
        ? `${years[0]}`
        : `${years[years.length - 1]}-${years[0]}`
      : "";

  if (!expanded) {
    return (
      <div className="absolute top-3 left-3 z-10">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="glass-panel px-2.5 py-1.5 text-xs flex items-center gap-1.5"
          style={{
            background: isDark ? "rgba(15, 23, 36, 0.8)" : "rgba(240, 244, 248, 0.85)",
            backdropFilter: "blur(8px)",
          }}
        >
          <span style={{ opacity: 0.6 }}>
            {shownCount} routes · {formattedDistance} {distanceLabel}
          </span>
          <ChevronDownIcon size={10} />
        </button>
      </div>
    );
  }

  return (
    <div
      className="absolute top-3 left-3 right-3 z-10 glass-panel"
      style={{
        background: isDark ? "rgba(15, 23, 36, 0.8)" : "rgba(240, 244, 248, 0.85)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
        {/* Sport pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => onToggleAllSports(!allSportsEnabled)}
            className="text-xs text-slate-light hover:text-body-text px-1"
          >
            {allSportsEnabled ? "None" : "All"}
          </button>
          {sports.map(({ sport, count }) => (
            <SportPill
              key={sport}
              sport={sport}
              count={count}
              enabled={enabledSports.has(sport)}
              isDark={isDark}
              onToggle={() => onToggleSport(sport)}
            />
          ))}
        </div>

        {/* Year pills */}
        {years.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            <button
              type="button"
              onClick={() => onToggleAllYears(!allYearsEnabled)}
              className="text-xs text-slate-light hover:text-body-text px-1"
            >
              {allYearsEnabled ? "None" : "All"}
            </button>
            {years.map((year) => (
              <YearPill
                key={year}
                year={year}
                enabled={enabledYears.has(year)}
                onToggle={() => onToggleYear(year)}
              />
            ))}
          </div>
        )}

        {/* Stats + actions */}
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-xs text-slate-light whitespace-nowrap">
            {shownCount} routes · {yearRange} · {formattedDistance} {distanceLabel}
          </span>

          {atLimit && (
            <span className="text-xs text-slate-light/60 whitespace-nowrap">
              (showing {limit} most recent)
            </span>
          )}

          <button
            type="button"
            onClick={onSaveImage}
            className="text-xs text-slate-light hover:text-accent-cyan whitespace-nowrap"
            title="Save as PNG"
          >
            Save
          </button>

          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-slate-light hover:text-body-text p-0.5"
            title="Collapse toolbar"
          >
            <ChevronDownIcon size={10} className="rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}
