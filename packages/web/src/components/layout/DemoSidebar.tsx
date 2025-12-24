import { useNavigate } from "react-router-dom";
import GoalControls from "../GoalControls";
import type { Goals } from "../../utils/goalCalculations";
import type { MetricUnit } from "../../utils/units";
import { getDemoAvailableSports } from "../../hooks/useDemoData";

interface DemoSidebarProps {
  currentYear: number;
  onYearClick: (year: number) => void;
  goals: Goals;
  onGoalsChange: (goals: Goals) => void;
  estimatedYearEnd: number;
  currentDistance: number;
  sport?: string;
  unit?: MetricUnit;
  isLoading?: boolean;
}

const AVAILABLE_YEARS = [2025, 2024, 2023];

/**
 * Sidebar for demo mode - uses fixture data, no API calls.
 */
export default function DemoSidebar({
  currentYear,
  onYearClick,
  goals,
  onGoalsChange,
  estimatedYearEnd,
  currentDistance,
  sport = "cycling",
  unit = "miles",
  isLoading = false,
}: DemoSidebarProps) {
  const navigate = useNavigate();
  const availableSports = getDemoAvailableSports();

  const handleSportChange = (newSport: string) => {
    navigate(`/demo/${newSport}/${currentYear}`);
  };

  const capitalizeFirst = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);

  return (
    <div className="sidebar border border-right col-md-3 col-lg-2 p-0 bg-body-tertiary">
      <div
        className="offcanvas-md offcanvas-start bg-body-tertiary"
        data-tabindex="-1"
        id="sidebarMenu"
        aria-labelledby="sidebarMenuLabel"
      >
        <div className="offcanvas-header">
          <h5 className="offcanvas-title" id="sidebarMenuLabel">
            Desire Lines
          </h5>
          <button
            type="button"
            className="btn-close"
            data-bs-dismiss="offcanvas"
            data-bs-target="#sidebarMenu"
            aria-label="Close"
          ></button>
        </div>
        <div className="offcanvas-body d-flex flex-column p-0 pt-lg-3 overflow-y-auto">
          {/* Progress Summary */}
          <div className="px-3 pt-3 pb-2">
            <div className="d-flex justify-content-between small">
              <span className="text-muted">Current</span>
              <span className="fw-semibold">
                {isLoading || currentDistance === 0
                  ? "--"
                  : `${currentDistance.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unit}`}
              </span>
            </div>
            <div className="d-flex justify-content-between small">
              <span className="text-muted">Est. Year-End</span>
              <span className="fw-semibold">
                {isLoading || estimatedYearEnd === 0
                  ? "--"
                  : `${estimatedYearEnd.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unit}`}
              </span>
            </div>
          </div>

          <hr className="my-2" />

          {/* Filters Section */}
          <h6 className="sidebar-heading px-3 mt-2 mb-3 text-body-secondary text-uppercase">
            <span>Filters</span>
          </h6>

          <div className="px-3 mb-3">
            {/* Activity Type Selector */}
            <div className="d-flex align-items-center mb-2">
              <label
                className="form-label small text-muted mb-0 text-start"
                style={{ minWidth: "65px" }}
              >
                Sport
              </label>
              <select
                className="form-select form-select-sm flex-grow-1"
                value={sport}
                onChange={(e) => handleSportChange(e.target.value)}
              >
                {availableSports.map((sportId) => (
                  <option key={sportId} value={sportId}>
                    {capitalizeFirst(sportId)}
                  </option>
                ))}
              </select>
            </div>

            {/* Year Selector */}
            <div className="d-flex align-items-center">
              <label
                className="form-label small text-muted mb-0 text-start"
                style={{ minWidth: "65px" }}
              >
                Year
              </label>
              <select
                className="form-select form-select-sm flex-grow-1"
                value={currentYear}
                onChange={(e) => onYearClick(Number(e.target.value))}
              >
                {AVAILABLE_YEARS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <hr className="my-3" />

          <div className="px-3">
            <GoalControls
              goals={goals}
              onGoalsChange={onGoalsChange}
              estimatedYearEnd={estimatedYearEnd}
              unit={unit}
              sport={sport}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
