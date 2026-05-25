import { useTheme } from "../../contexts/ThemeContext";
import type { SportColorMap } from "./RouteCanvas";
import type { DistanceUnit } from "../../utils/units";
import { convertDistance, getDistanceLabel } from "../../utils/units";
import { usePublicSportConfig } from "../../hooks/usePublicSportConfig";
import { getSportDisplayName } from "../../utils/sportConfig";

interface SportInfo {
  sport: string;
  count: number;
}

interface RouteLegendProps {
  sports: SportInfo[];
  years: number[];
  enabledSports: Set<string>;
  enabledYears: Set<number>;
  sportColors: SportColorMap;
  shownCount: number;
  shownDistanceMeters: number;
  atLimit: boolean;
  limit: number;
  distanceUnit: DistanceUnit;
  onToggleSport: (sport: string) => void;
  onToggleYear: (year: number) => void;
  onToggleAllSports: (enabled: boolean) => void;
  onToggleAllYears: (enabled: boolean) => void;
  showRings: boolean;
  onToggleRings: () => void;
  onSaveImage: () => void;
}

function ColorSwatch({ rgb }: { rgb: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ background: `rgb(${rgb})` }}
    />
  );
}

export default function RouteLegend({
  sports,
  years,
  enabledSports,
  enabledYears,
  sportColors,
  shownCount,
  shownDistanceMeters,
  atLimit,
  limit,
  distanceUnit,
  onToggleSport,
  onToggleYear,
  onToggleAllSports,
  onToggleAllYears,
  showRings,
  onToggleRings,
  onSaveImage,
}: RouteLegendProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const { sportConfig } = usePublicSportConfig();

  const distanceValue = convertDistance(shownDistanceMeters, distanceUnit);
  const distanceLabel = getDistanceLabel(distanceUnit);
  const formattedDistance =
    distanceValue >= 100 ? Math.round(distanceValue).toLocaleString() : distanceValue.toFixed(1);

  const allSportsEnabled = sports.length > 0 && sports.every((s) => enabledSports.has(s.sport));
  const allYearsEnabled = years.length > 0 && years.every((y) => enabledYears.has(y));

  const glassPanelStyle = {
    background: isDark ? "rgba(15, 23, 36, 0.8)" : "rgba(240, 244, 248, 0.85)",
    backdropFilter: "blur(8px)",
  };

  return (
    <div className="absolute top-3 left-3 right-3 z-10 glass-panel" style={glassPanelStyle}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        {/* Sport filter */}
        <div className="flex items-center gap-2">
          <span className="text-slate-light text-xs whitespace-nowrap">Sport:</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleAllSports(!allSportsEnabled)}
              className="text-xs text-slate-light hover:text-accent-cyan px-1"
            >
              {allSportsEnabled ? "None" : "All"}
            </button>
            {sports.map(({ sport, count }) => {
              const enabled = enabledSports.has(sport);
              const rgb = sportColors.get(sport) ?? "128, 128, 128";
              const displayName = getSportDisplayName(sport, sportConfig);
              return (
                <button
                  key={sport}
                  type="button"
                  onClick={() => onToggleSport(sport)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-opacity"
                  style={{ opacity: enabled ? 1 : 0.35 }}
                  title={`${displayName}: ${count} routes`}
                >
                  <ColorSwatch rgb={rgb} />
                  <span style={{ color: `rgb(${rgb})` }}>{displayName}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Year filter */}
        <div className="flex items-center gap-2">
          <span className="text-slate-light text-xs whitespace-nowrap">Year:</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onToggleAllYears(!allYearsEnabled)}
              className="text-xs text-slate-light hover:text-accent-cyan px-1"
            >
              {allYearsEnabled ? "None" : "All"}
            </button>
            {years.map((year) => {
              const enabled = enabledYears.has(year);
              return (
                <button
                  key={year}
                  type="button"
                  onClick={() => onToggleYear(year)}
                  className="px-1.5 py-0.5 rounded text-xs transition-opacity text-body-text"
                  style={{ opacity: enabled ? 1 : 0.35 }}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </div>

        {/* Distance rings toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleRings}
            className="text-xs px-1.5 py-0.5 rounded transition-opacity"
            style={{ opacity: showRings ? 1 : 0.35 }}
          >
            <span className="text-slate-light">Rings</span>
          </button>
        </div>

        {/* Stats + save */}
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-xs text-slate-light whitespace-nowrap">
            {shownCount} routes &middot; {formattedDistance} {distanceLabel}
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
        </div>
      </div>
    </div>
  );
}
