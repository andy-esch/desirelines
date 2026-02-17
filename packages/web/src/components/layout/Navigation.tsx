import { NavLink, useLocation } from "react-router-dom";
import { Menu, MenuButton, MenuItems, MenuItem, Transition } from "@headlessui/react";
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
    `nav-link no-underline ${isActive ? "active" : "text-white/50"}`;

  // Vertical layout for mobile drawer
  if (vertical) {
    return (
      <nav className={`nav flex-col nav-pills ${className}`}>
        <NavLink to="/" end className={linkClasses}>
          Dashboard
        </NavLink>
        <div className="mt-6 mb-1 ps-2">
          <span
            className="text-white/50 text-sm uppercase font-semibold"
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
          className={({ isActive }) =>
            `nav-link no-underline mt-2 ${isActive ? "active" : "text-white/50"}`
          }
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

      {/* Goals dropdown — Headless UI Menu */}
      <Menu as="div" className="relative">
        <MenuButton
          className={`nav-link ${isOnSportPage ? "active" : "text-white/50"}`}
          style={{ cursor: "pointer" }}
        >
          Goals <span style={{ fontSize: "0.65em" }}>▼</span>
        </MenuButton>

        <Transition
          enter="transition duration-100 ease-out"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="transition duration-75 ease-in"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <MenuItems
            className="absolute left-0 mt-1 rounded-lg py-1 shadow-lg"
            style={{
              backgroundColor: "var(--color-header-bg)",
              border: "1px solid var(--color-header-border)",
              minWidth: "160px",
              zIndex: 50,
            }}
          >
            {sports.map((sport) => (
              <MenuItem key={sport.id}>
                {({ focus }) => (
                  <NavLink
                    to={`/${sport.id}/${currentYear}`}
                    className={({ isActive }) =>
                      `block px-4 py-2 text-sm no-underline ${
                        isActive
                          ? "bg-white/15 text-white"
                          : focus
                            ? "bg-white/10 text-white"
                            : "text-header-text"
                      }`
                    }
                  >
                    {sport.label}
                  </NavLink>
                )}
              </MenuItem>
            ))}
          </MenuItems>
        </Transition>
      </Menu>

      {/* Activities link */}
      <NavLink to="/activities" className={linkClasses}>
        Activities
      </NavLink>
    </nav>
  );
}
