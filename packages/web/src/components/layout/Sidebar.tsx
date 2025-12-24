import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import GoalControls from "../GoalControls";
import type { Goals } from "../../utils/goalCalculations";
import { fetchYearMetadata, fetchSportConfig } from "../../api/activities";
import type { MetricUnit } from "../../utils/units";
import { useAuth } from "../../hooks/useAuth";
import { useAuthToken } from "../../hooks/useAuthToken";
import { useLocalStorage } from "../../hooks/useLocalStorage";

interface SidebarProps {
  currentYear: number;
  onYearClick: (year: number) => void;
  goals: Goals;
  onGoalsChange: (goals: Goals) => void;
  estimatedYearEnd: number;
  currentDistance: number;
  sport?: string; // Current sport (cycling, running, yoga)
  unit?: MetricUnit; // Unit label (e.g., "miles", "kilometers", "sessions")
  isLoading?: boolean; // Whether data is still loading
}

const AVAILABLE_YEARS = [2025, 2024, 2023];

// Sidebar section collapse state type
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
  sport = "cycling", // Default to cycling if not provided
  unit = "miles", // Default to miles
  isLoading = false,
}: SidebarProps) {
  const navigate = useNavigate();
  const { loading } = useAuth();
  const { getToken } = useAuthToken();
  const [availableSports, setAvailableSports] = useState<string[]>(["cycling"]); // Default fallback

  // Collapsible section state (persisted to localStorage)
  const [expandedSections, setExpandedSections] = useLocalStorage<SidebarSections>(
    "sidebar-sections",
    { filters: true, goals: true } // Both expanded by default
  );

  const toggleSection = (section: keyof SidebarSections) => {
    setExpandedSections({
      ...expandedSections,
      [section]: !expandedSections[section],
    });
  };

  // Fetch available sports from metadata
  useEffect(() => {
    // Don't make API calls while auth is still loading
    if (loading) {
      return;
    }

    const controller = new AbortController();

    async function loadSports() {
      try {
        const idToken = await getToken();

        // Fetch both metadata (raw Strava types with data) and config (category definitions)
        const [metadata, sportConfig] = await Promise.all([
          fetchYearMetadata(currentYear, controller.signal, idToken),
          fetchSportConfig(controller.signal, idToken),
        ]);

        // metadata.sports contains raw Strava types (e.g., ["Ride", "Run", "MountainBikeRide"])
        // We need to find which categories have at least one matching Strava type
        const rawSportsWithData = new Set(metadata.sports || []);
        const categoriesWithData: string[] = [];

        for (const [category, config] of Object.entries(sportConfig.sport_categories)) {
          // Check if any of this category's Strava types have data
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
        // Silently fail - keep default sports
        console.warn("Failed to fetch available sports, using defaults:", err);
      }
    }

    loadSports();

    return () => {
      controller.abort();
    };
  }, [currentYear, loading, getToken]);

  const handleSportChange = (newSport: string) => {
    // Use currentYear prop (source of truth from parent component)
    // Preserves year when switching sports
    navigate(`/${newSport}/${currentYear}`);
  };

  // Convert sport IDs to display format
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
        <div className="offcanvas-body d-md-flex flex-column p-0 pt-lg-3 overflow-y-auto">
          {/* Filters Section */}
          <button
            className="sidebar-heading px-3 mt-4 mb-0 text-body-secondary text-uppercase d-flex align-items-center justify-content-between w-100 bg-transparent border-0"
            onClick={() => toggleSection("filters")}
            aria-expanded={expandedSections.filters}
            aria-controls="filters-collapse"
            style={{ cursor: "pointer" }}
          >
            <span className="fw-semibold" style={{ fontSize: "0.75rem", letterSpacing: "0.05em" }}>
              Filters
            </span>
            <span style={{ fontSize: "0.65rem", transition: "transform 0.2s" }}>
              {expandedSections.filters ? "▲" : "▼"}
            </span>
          </button>

          <div
            id="filters-collapse"
            className={`collapse ${expandedSections.filters ? "show" : ""}`}
          >
            <div className="px-3 py-3">
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
          </div>

          <hr className="my-2" />

          {/* Goals Section */}
          <button
            className="sidebar-heading px-3 mb-0 text-body-secondary text-uppercase d-flex align-items-center justify-content-between w-100 bg-transparent border-0"
            onClick={() => toggleSection("goals")}
            aria-expanded={expandedSections.goals}
            aria-controls="goals-collapse"
            style={{ cursor: "pointer" }}
          >
            <span className="fw-semibold" style={{ fontSize: "0.75rem", letterSpacing: "0.05em" }}>
              Goals
            </span>
            <span style={{ fontSize: "0.65rem", transition: "transform 0.2s" }}>
              {expandedSections.goals ? "▲" : "▼"}
            </span>
          </button>

          <div id="goals-collapse" className={`collapse ${expandedSections.goals ? "show" : ""}`}>
            <div className="px-3 py-3">
              <GoalControls
                goals={goals}
                onGoalsChange={onGoalsChange}
                estimatedYearEnd={estimatedYearEnd}
                currentDistance={currentDistance}
                unit={unit}
                sport={sport}
                isLoading={isLoading}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
