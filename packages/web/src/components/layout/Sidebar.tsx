import GoalControls from "../GoalControls";
import type { Goals } from "../../utils/goalCalculations";

interface SidebarProps {
  currentYear: number;
  onYearClick: (year: number) => void;
  goals: Goals;
  onGoalsChange: (goals: Goals) => void;
  estimatedYearEnd: number;
  currentDistance: number;
}

const AVAILABLE_YEARS = [2025, 2024, 2023];

export default function Sidebar({
  currentYear,
  onYearClick,
  goals,
  onGoalsChange,
  estimatedYearEnd,
  currentDistance,
}: SidebarProps) {
  return (
    <div className="sidebar border border-right col-md-3 col-lg-2 p-0 bg-body-tertiary">
      <div
        className="offcanvas-md offcanvas-end bg-body-tertiary"
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
        <div className="offcanvas-body d-md-flex flex-column p-0 pt-lg-3 overflow-y-auto">
          {/* Filters Section */}
          <h6 className="sidebar-heading px-3 mt-4 mb-3 text-body-secondary text-uppercase">
            <span>Filters</span>
          </h6>

          <div className="px-3 mb-3">
            {/* Activity Type Selector */}
            <div className="d-flex align-items-center mb-2">
              <label
                className="form-label small text-muted mb-0 text-start"
                style={{ minWidth: "65px" }}
              >
                Activity
              </label>
              <select className="form-select form-select-sm flex-grow-1" disabled>
                <option>Ride</option>
                <option>Run (Soon)</option>
                <option>Swim (Soon)</option>
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
              currentDistance={currentDistance}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
