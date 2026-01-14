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
 * Reusable across Sidebar and DemoSidebar.
 */
export default function FilterControls({
  sport,
  availableSports,
  sportCounts,
  onSportChange,
  currentYear,
  onYearChange,
}: FilterControlsProps) {
  return (
    <>
      {/* Sport Selector */}
      <div className="d-flex align-items-center mb-1">
        <label className="form-label small text-muted mb-0 text-start" style={{ minWidth: "65px" }}>
          Sport
        </label>
        <select
          className="form-select form-select-sm flex-grow-1"
          value={sport}
          onChange={(e) => onSportChange(e.target.value)}
        >
          {availableSports.map((sportId) => {
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
      </div>
      <SportVisibilityHint className="mb-2" style={{ paddingLeft: "65px" }} />

      {/* Year Selector */}
      <div className="d-flex align-items-center">
        <label className="form-label small text-muted mb-0 text-start" style={{ minWidth: "65px" }}>
          Year
        </label>
        <select
          className="form-select form-select-sm flex-grow-1"
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
