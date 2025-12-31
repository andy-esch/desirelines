import { useNavigate } from "react-router-dom";
import GoalControls from "../GoalControls";
import ProgressSummary from "./ProgressSummary";
import SidebarSection from "./SidebarSection";
import FilterControls from "./FilterControls";
import type { Goals } from "../../utils/goalCalculations";
import type { MetricUnit } from "../../utils/units";
import { getDemoAvailableSports } from "../../hooks/useDemoData";
import { useLocalStorage } from "../../hooks/useLocalStorage";

interface DemoSidebarProps {
  currentYear: number;
  onYearClick: (year: number) => void;
  goals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  estimatedYearEnd: number;
  currentDistance: number;
  sport?: string;
  unit?: MetricUnit;
  isLoading?: boolean;
  // Goal mutation state (always false/null for demo - localStorage is sync)
  isSaving?: boolean;
  saveError?: Error | null;
}

interface SidebarSections {
  filters: boolean;
  goals: boolean;
}

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
  isSaving = false,
  saveError = null,
}: DemoSidebarProps) {
  const navigate = useNavigate();
  const availableSports = getDemoAvailableSports();

  const [expandedSections, setExpandedSections] = useLocalStorage<SidebarSections>(
    "sidebar-sections",
    { filters: true, goals: true }
  );

  const toggleSection = (section: keyof SidebarSections) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section],
    });
  };

  const handleSportChange = (newSport: string) => {
    navigate(`/demo/${newSport}/${currentYear}`);
  };

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
          <ProgressSummary
            currentDistance={currentDistance}
            estimatedYearEnd={estimatedYearEnd}
            unit={unit}
            isLoading={isLoading}
          />

          <hr className="my-2" />

          <SidebarSection
            title="Filters"
            id="filters"
            isExpanded={expandedSections.filters}
            onToggle={() => toggleSection("filters")}
          >
            <FilterControls
              sport={sport}
              availableSports={availableSports}
              onSportChange={handleSportChange}
              currentYear={currentYear}
              onYearChange={onYearClick}
            />
          </SidebarSection>

          <hr className="my-2" />

          <SidebarSection
            title="Goals"
            id="goals"
            isExpanded={expandedSections.goals}
            onToggle={() => toggleSection("goals")}
          >
            <GoalControls
              goals={goals}
              onGoalsChange={onGoalsChange}
              estimatedYearEnd={estimatedYearEnd}
              unit={unit}
              sport={sport}
              isSaving={isSaving}
              saveError={saveError}
            />
          </SidebarSection>
        </div>
      </div>
    </div>
  );
}
