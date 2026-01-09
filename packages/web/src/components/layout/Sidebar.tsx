import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import GoalControls from "../GoalControls";
import AuthButton from "../AuthButton";
import ProgressSummary from "./ProgressSummary";
import SidebarSection from "./SidebarSection";
import FilterControls from "./FilterControls";
import type { Goals } from "../../utils/goalCalculations";
import { fetchYearMetadata, fetchSportConfig } from "../../api/activities";
import { isCancellationError } from "../../api/errors";
import type { MetricUnit } from "../../utils/units";
import { useAuth } from "../../hooks/useAuth";
import { useAuthToken } from "../../hooks/useAuthToken";
import { useLocalStorage } from "../../hooks/useLocalStorage";

interface SidebarProps {
  currentYear: number;
  onYearClick: (year: number) => void;
  goals: Goals;
  onGoalsChange: (goals: Goals) => Promise<void>;
  estimatedYearEnd: number;
  currentDistance: number;
  sport?: string;
  unit?: MetricUnit;
  isLoading?: boolean;
  // Goal mutation state from useUserConfig
  isSaving?: boolean;
  saveError?: Error | null;
  onClearSaveError?: () => void;
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
  currentDistance,
  sport = "cycling",
  unit = "miles",
  isLoading = false,
  isSaving = false,
  saveError = null,
  onClearSaveError,
}: SidebarProps) {
  const navigate = useNavigate();
  const { loading } = useAuth();
  const { getToken } = useAuthToken();
  const [availableSports, setAvailableSports] = useState<string[]>(["cycling"]);

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

  // Fetch available sports from metadata
  useEffect(() => {
    if (loading) return;

    const controller = new AbortController();

    async function loadSports() {
      try {
        const idToken = await getToken();
        const [metadata, sportConfig] = await Promise.all([
          fetchYearMetadata(currentYear, controller.signal, idToken),
          fetchSportConfig(controller.signal, idToken),
        ]);

        const rawSportsWithData = new Set(metadata.sports || []);
        const categoriesWithData: string[] = [];

        for (const [category, config] of Object.entries(sportConfig.sport_categories)) {
          const hasData = config.strava_types.some((stravaType) =>
            rawSportsWithData.has(stravaType)
          );
          if (hasData) {
            categoriesWithData.push(category);
          }
        }

        if (categoriesWithData.length > 0) {
          setAvailableSports(categoriesWithData);
        }
      } catch (err) {
        // Only log real errors, not cancellations (which are expected behavior)
        if (!isCancellationError(err)) {
          console.warn("Failed to fetch available sports, using defaults:", err);
        }
      }
    }

    loadSports();
    return () => controller.abort();
  }, [currentYear, loading, getToken]);

  const handleSportChange = (newSport: string) => {
    navigate(`/${newSport}/${currentYear}`);
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
              onClearSaveError={onClearSaveError}
            />
          </SidebarSection>

          {/* Login/Logout - mobile only */}
          <div className="d-md-none mt-auto px-3 py-3 border-top">
            <AuthButton signOutVariant="outline-secondary" />
          </div>
        </div>
      </div>
    </div>
  );
}
