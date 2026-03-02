import { Link, useLocation } from "@tanstack/react-router";
import { Menu, MenuButton, MenuItems, MenuItem, Transition } from "@headlessui/react";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { useSportConfig } from "../../hooks/useSportConfig";
import { useCurrentYear } from "../../hooks/useCurrentYear";
import { useAuth } from "../../hooks/useAuth";

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
  const { user } = useAuth();
  const { visibleSports } = useVisibleSports();
  const { sportConfig } = useSportConfig();

  // Build sports list from visible sports with display names from config
  // Fallback to capitalized id if config not loaded yet
  const sports = visibleSports.map((id) => ({
    id,
    label:
      sportConfig?.sportCategories[id]?.displayName || id.charAt(0).toUpperCase() + id.slice(1),
  }));

  // Determine if we're on a sport/goals page
  const isOnSportPage = sports.some((s) => location.pathname.startsWith(`/${s.id}`));

  // Vertical layout for mobile drawer
  if (vertical) {
    return (
      <nav className={`nav flex-col nav-pills ${className}`}>
        <Link
          to="/"
          activeOptions={{ exact: true }}
          activeProps={{ className: "nav-link no-underline active" }}
          inactiveProps={{ className: "nav-link no-underline text-white/50" }}
        >
          Dashboard
        </Link>
        <div className="mt-6 mb-1 ps-2">
          <span
            className="text-white/50 text-sm uppercase font-semibold"
            style={{ fontSize: "0.65rem", letterSpacing: "0.05em" }}
          >
            Goals
          </span>
        </div>
        {sports.map((sport) => (
          <Link
            key={sport.id}
            to="/$sport/$year"
            params={{ sport: sport.id, year: String(currentYear) }}
            activeProps={{ className: "nav-link no-underline active" }}
            inactiveProps={{ className: "nav-link no-underline text-white/50" }}
            style={{ paddingLeft: "1rem" }}
          >
            {sport.label}
          </Link>
        ))}
        <Link
          to="/activities"
          activeProps={{ className: "nav-link no-underline mt-2 active" }}
          inactiveProps={{ className: "nav-link no-underline mt-2 text-white/50" }}
        >
          Activities
        </Link>
        {user && (
          <Link
            to="/routes"
            activeProps={{ className: "nav-link no-underline active" }}
            inactiveProps={{ className: "nav-link no-underline text-white/50" }}
          >
            Routes
          </Link>
        )}
      </nav>
    );
  }

  // Horizontal layout with dropdown for desktop
  return (
    <nav className={`nav nav-pills ${className}`}>
      <Link
        to="/"
        activeOptions={{ exact: true }}
        activeProps={{ className: "nav-link no-underline active" }}
        inactiveProps={{ className: "nav-link no-underline text-white/50" }}
      >
        Dashboard
      </Link>

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
                  <Link
                    to="/$sport/$year"
                    params={{ sport: sport.id, year: String(currentYear) }}
                    activeProps={{
                      className: "block px-4 py-2 text-sm no-underline bg-white/15 text-white",
                    }}
                    inactiveProps={{
                      className: `block px-4 py-2 text-sm no-underline ${
                        focus ? "bg-white/10 text-white" : "text-header-text"
                      }`,
                    }}
                  >
                    {sport.label}
                  </Link>
                )}
              </MenuItem>
            ))}
          </MenuItems>
        </Transition>
      </Menu>

      {/* Activities link */}
      <Link
        to="/activities"
        activeProps={{ className: "nav-link no-underline active" }}
        inactiveProps={{ className: "nav-link no-underline text-white/50" }}
      >
        Activities
      </Link>

      {/* Routes link — authenticated only */}
      {user && (
        <Link
          to="/routes"
          activeProps={{ className: "nav-link no-underline active" }}
          inactiveProps={{ className: "nav-link no-underline text-white/50" }}
        >
          Routes
        </Link>
      )}
    </nav>
  );
}
