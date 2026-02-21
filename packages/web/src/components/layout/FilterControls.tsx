import { AVAILABLE_YEARS } from "../../constants/sidebar";
import { capitalizeFirst } from "../../utils/format";
import SportVisibilityHint from "../SportVisibilityHint";
import StyledSelect from "../StyledSelect";

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
 * Uses styled Listbox dropdowns.
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

  const sportOptions = sportsToShow.map((sportId) => {
    const count = sportCounts?.[sportId];
    const label =
      count !== undefined ? `${capitalizeFirst(sportId)} (${count})` : capitalizeFirst(sportId);
    return { value: sportId, label };
  });

  const yearOptions = AVAILABLE_YEARS.map((year) => ({
    value: String(year),
    label: String(year),
  }));

  return (
    <>
      {/* Sport Selector */}
      <div className="flex items-center mb-1">
        <label
          htmlFor="sport-selector"
          className="form-label text-sm text-slate-light mb-0 text-left"
          style={{ minWidth: "50px" }}
        >
          Sport
        </label>
        <StyledSelect
          id="sport-selector"
          value={sport}
          onChange={onSportChange}
          options={sportOptions}
          disabled={sportsToShow.length === 0}
          className="grow"
        />
      </div>
      <SportVisibilityHint className="mb-2" style={{ paddingLeft: "50px" }} />

      {/* Year Selector */}
      <div className="flex items-center">
        <label
          htmlFor="year-selector"
          className="form-label text-sm text-slate-light mb-0 text-left"
          style={{ minWidth: "50px" }}
        >
          Year
        </label>
        <StyledSelect
          id="year-selector"
          value={String(currentYear)}
          onChange={(val) => onYearChange(Number(val))}
          options={yearOptions}
          className="grow"
        />
      </div>
    </>
  );
}
