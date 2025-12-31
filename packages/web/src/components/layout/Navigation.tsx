import { NavLink, useLocation } from "react-router-dom";

const SPORTS = [
  { id: "cycling", label: "Cycling", icon: "\u{1F6B2}" },
  { id: "running", label: "Running", icon: "\u{1F3C3}" },
  { id: "yoga", label: "Yoga", icon: "\u{1F9D8}" },
] as const;

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
  const currentYear = new Date().getFullYear();
  const location = useLocation();

  // Determine if we're on a sport/goals page
  const isOnSportPage = SPORTS.some((s) => location.pathname.startsWith(`/${s.id}`));

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
        {SPORTS.map((sport) => (
          <NavLink
            key={sport.id}
            to={`/${sport.id}/${currentYear}`}
            className={linkClasses}
            style={{ paddingLeft: "1rem" }}
          >
            <span className="me-2">{sport.icon}</span>
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
          {SPORTS.map((sport) => (
            <li key={sport.id}>
              <NavLink
                to={`/${sport.id}/${currentYear}`}
                className={({ isActive }) =>
                  `dropdown-item d-flex align-items-center ${isActive ? "active" : ""}`
                }
              >
                <span className="me-2">{sport.icon}</span>
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
