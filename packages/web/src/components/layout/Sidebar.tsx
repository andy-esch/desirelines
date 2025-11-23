import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import GoalControls from "../GoalControls";
import type { Goals } from "../../utils/goalCalculations";
import { fetchYearMetadata } from "../../api/activities";
import type { MetricUnit } from "../../utils/units";
import { USE_FIXTURE_DATA } from "../../config";
import { FIXTURE_METADATA } from "../../data/fixtures";
import { useAuth } from "../../hooks/useAuth";
import { useAuthToken } from "../../hooks/useAuthToken";

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
  const { user, loading } = useAuth();
  const { getToken } = useAuthToken();
  const [availableSports, setAvailableSports] = useState<string[]>(["cycling"]); // Default fallback

  // Fetch available sports from metadata
  useEffect(() => {
    // Don't make API calls while auth is still loading
    if (loading) {
      return;
    }

    const controller = new AbortController();

    async function loadSports() {
      try {
        // Smart mode: Use fixtures for anonymous users when USE_FIXTURE_DATA=true
        // Authenticated users always fetch from API (even if USE_FIXTURE_DATA=true)
        const shouldUseFixtures = USE_FIXTURE_DATA && !user;

        if (shouldUseFixtures) {
          const metadata = FIXTURE_METADATA[currentYear];
          if (metadata?.sports && metadata.sports.length > 0) {
            setAvailableSports(metadata.sports);
          }
        } else {
          // Fetch from API with authentication
          const idToken = await getToken();

          const metadata = await fetchYearMetadata(currentYear, controller.signal, idToken);
          if (metadata.sports && metadata.sports.length > 0) {
            setAvailableSports(metadata.sports);
          }
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
  }, [currentYear, user, loading, getToken]);

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
              currentDistance={currentDistance}
              unit={unit}
              sport={sport}
              isLoading={isLoading}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
