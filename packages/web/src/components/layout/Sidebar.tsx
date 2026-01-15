import { useNavigate } from "react-router-dom";
import GoalControls from "../GoalControls";
import AuthButton from "../AuthButton";
import ProgressSummary from "./ProgressSummary";
import SidebarSection from "./SidebarSection";
import FilterControls from "./FilterControls";
import type { Goals } from "../../utils/goalCalculations";
import type { MetricUnit } from "../../utils/units";
import { useLocalStorage } from "../../hooks/useLocalStorage";

interface SidebarProps {
  currentYear: number;
  onYearClick: (year: number) => void;
  goals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  estimatedYearEnd: number;
  /** Current cumulative value (distance in miles/km, or session count) */
  currentValue: number;
  sport?: string;
  unit?: MetricUnit;
  isLoading?: boolean;
  // Goal mutation state from useUserConfig
  isSaving?: boolean;
  saveError?: Error | null;
  onClearSaveError?: () => void;
  // Sport data (passed from parent via hooks)
  availableSports: string[];
  sportCounts: Record<string, number>;
  // Navigation prefix: "/" for authenticated, "/demo/" for demo mode
  navigationPrefix?: string;
  // Whether to show auth button on mobile (false for demo mode)
  showAuthButton?: boolean;
}

interface SidebarSections {
  filters: boolean;
  goals: boolean;
}

export default function Sidebar({
  currentYear,
  onYearClick,
  goals,
  onGoalsChange,
  estimatedYearEnd,
  currentValue,
  sport = "cycling",
  unit = "miles",
  isLoading = false,
  isSaving = false,
  saveError = null,
  onClearSaveError,
  availableSports,
  sportCounts,
  navigationPrefix = "/",
  showAuthButton = true,
}: SidebarProps) {
  const navigate = useNavigate();

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
    navigate(`${navigationPrefix}${newSport}/${currentYear}`);
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
            currentValue={currentValue}
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
              sportCounts={sportCounts}
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
              onClearSaveError={onClearSaveError}
            />
          </SidebarSection>

          {/* Login/Logout - mobile only, hidden in demo mode */}
          {showAuthButton && (
            <div className="d-md-none mt-auto px-3 py-3 border-top">
              <AuthButton signOutVariant="outline-secondary" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
