import { AVAILABLE_YEARS } from "../../constants/sidebar";
import { capitalizeFirst } from "../../utils/format";
import SportVisibilityHint from "../SportVisibilityHint";

interface FilterControlsProps {
  /** Currently selected sport */
  sport: string;
  /** List of available sports to choose from */
  availableSports: string[];
  /** Activity counts per sport (optional, for display) */
  sportCounts?: Record<string, number>;
  /** Callback when sport selection changes */
  onSportChange: (sport: string) => void;
  /** Currently selected year */
  currentYear: number;
  /** Callback when year selection changes */
  onYearChange: (year: number) => void;
}

/**
 * Sport and Year filter controls for the sidebar.
 * Used in both authenticated and demo modes.
 */
export default function FilterControls({
  sport,
  availableSports,
  sportCounts,
  onSportChange,
  currentYear,
  onYearChange,
}: FilterControlsProps) {
  // Ensure current sport is in the list (prevents invalid dropdown state)
  const sportsToShow =
    availableSports.length > 0 && !availableSports.includes(sport)
      ? [sport, ...availableSports]
      : availableSports;

  return (
    <>
      {/* Sport Selector */}
      <div className="flex items-center mb-1">
        <label
          className="form-label text-sm text-slate-light mb-0 text-left"
          style={{ minWidth: "65px" }}
        >
          Sport
        </label>
        {sportsToShow.length === 0 ? (
          <select className="form-select form-select-sm grow" disabled>
            <option>No sports available</option>
          </select>
        ) : (
          <select
            className="form-select form-select-sm grow"
            value={sport}
            onChange={(e) => onSportChange(e.target.value)}
          >
            {sportsToShow.map((sportId) => {
              const count = sportCounts?.[sportId];
              const label =
                count !== undefined
                  ? `${capitalizeFirst(sportId)} (${count})`
                  : capitalizeFirst(sportId);
              return (
                <option key={sportId} value={sportId}>
                  {label}
                </option>
              );
            })}
          </select>
        )}
      </div>
      <SportVisibilityHint className="mb-2" style={{ paddingLeft: "65px" }} />

      {/* Year Selector */}
      <div className="flex items-center">
        <label
          className="form-label text-sm text-slate-light mb-0 text-left"
          style={{ minWidth: "65px" }}
        >
          Year
        </label>
        <select
          className="form-select form-select-sm grow"
          value={currentYear}
          onChange={(e) => onYearChange(Number(e.target.value))}
        >
          {AVAILABLE_YEARS.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
