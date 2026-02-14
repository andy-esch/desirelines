import { NavLink, useLocation } from "react-router-dom";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { useSportConfig } from "../../hooks/useSportConfig";
import { useCurrentYear } from "../../hooks/useCurrentYear";

interface NavigationProps {
  className?: string;
  /** When true, renders vertical nav (for mobile offcanvas) */
  vertical?: boolean;
}

/**
 * Main navigation links for Dashboard and sport pages.
 * Used in Header for desktop horizontal nav and mobile offcanvas menu.
 */
export default function Navigation({ className = "", vertical = false }: NavigationProps) {
  const currentYear = useCurrentYear();
  const location = useLocation();
  const { visibleSports } = useVisibleSports();
  const { sportConfig } = useSportConfig();

  // Build sports list from visible sports with display names from config
  // Fallback to capitalized id if config not loaded yet
  const sports = visibleSports.map((id) => ({
    id,
    label:
      sportConfig?.sport_categories[id]?.display_name || id.charAt(0).toUpperCase() + id.slice(1),
  }));

  // Determine if we're on a sport/goals page
  const isOnSportPage = sports.some((s) => location.pathname.startsWith(`/${s.id}`));

  const linkClasses = ({ isActive }: { isActive: boolean }) =>
    `nav-link ${isActive ? "active" : "text-white-50"}`;

  // Vertical layout for mobile offcanvas
  if (vertical) {
    return (
      <nav className={`nav flex-column nav-pills ${className}`}>
        <NavLink to="/" end className={linkClasses}>
          Dashboard
        </NavLink>
        <div className="mt-3 mb-1 ps-2">
          <span
            className="text-white-50 small text-uppercase fw-semibold"
            style={{ fontSize: "0.65rem", letterSpacing: "0.05em" }}
          >
            Goals
          </span>
        </div>
        {sports.map((sport) => (
          <NavLink
            key={sport.id}
            to={`/${sport.id}/${currentYear}`}
            className={linkClasses}
            style={{ paddingLeft: "1rem" }}
          >
            {sport.label}
          </NavLink>
        ))}
        <NavLink
          to="/activities"
          className={({ isActive }) => `nav-link mt-2 ${isActive ? "active" : "text-white-50"}`}
        >
          Activities
        </NavLink>
      </nav>
    );
  }

  // Horizontal layout with dropdown for desktop
  return (
    <nav className={`nav nav-pills ${className}`}>
      <NavLink to="/" end className={linkClasses}>
        Dashboard
      </NavLink>

      {/* Goals dropdown */}
      <div className="nav-item dropdown">
        <button
          className={`nav-link dropdown-toggle ${isOnSportPage ? "active" : "text-white-50"}`}
          data-bs-toggle="dropdown"
          aria-expanded="false"
          type="button"
        >
          Goals
        </button>
        <ul className="dropdown-menu">
          {sports.map((sport) => (
            <li key={sport.id}>
              <NavLink
                to={`/${sport.id}/${currentYear}`}
                className={({ isActive }) => `dropdown-item ${isActive ? "active" : ""}`}
              >
                {sport.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      {/* Activities link */}
      <NavLink to="/activities" className={linkClasses}>
        Activities
      </NavLink>
    </nav>
  );
}
