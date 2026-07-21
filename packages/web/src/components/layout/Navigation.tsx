import { Link, useLocation } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLinkItem,
} from "@/components/ui/dropdown-menu";
import { useVisibleSports } from "../../hooks/useVisibleSports";
import { useSportConfig } from "../../hooks/useSportConfig";
import { useCurrentYear } from "../../hooks/useCurrentYear";
import { pickActivitiesGroupSearch } from "../../utils/activitiesGroupParams";

interface NavigationProps {
  className?: string;
  /** When true, renders vertical nav (for mobile offcanvas) */
  vertical?: boolean;
}

/** The three coordinated views nested under the Activities dropdown. */
const ACTIVITIES_VIEWS = [
  { to: "/routes", label: "Routes" },
  { to: "/charts", label: "Charts" },
  { to: "/activities", label: "List" },
] as const;

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
      sportConfig?.sportCategories[id]?.displayName || id.charAt(0).toUpperCase() + id.slice(1),
  }));

  // Determine if we're on a sport/goals page
  const isOnSportPage = sports.some((s) => location.pathname.startsWith(`/${s.id}`));
  // The Activities group spans the three views nested under its dropdown.
  const isOnActivitiesGroup = ACTIVITIES_VIEWS.some((v) => location.pathname.startsWith(v.to));

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
        {/* Activities group: a labelled section (mirroring Goals) with the three
            coordinated views — shown for everyone, incl. demo/logged-out. */}
        <div className="mt-6 mb-1 ps-2">
          <span
            className="text-white/50 text-sm uppercase font-semibold"
            style={{ fontSize: "0.65rem", letterSpacing: "0.05em" }}
          >
            Activities
          </span>
        </div>
        {ACTIVITIES_VIEWS.map((v) => (
          <Link
            key={v.to}
            to={v.to}
            // Forward only the shared filters across view switches — never the
            // whole current search, which can carry another view's bookmarked
            // params past the strip middlewares (they don't run on initial load).
            search={pickActivitiesGroupSearch}
            activeProps={{ className: "nav-link no-underline active" }}
            inactiveProps={{ className: "nav-link no-underline text-white/50" }}
            style={{ paddingLeft: "1rem" }}
          >
            {v.label}
          </Link>
        ))}
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

      {/* Goals dropdown */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={`nav-link ${isOnSportPage ? "active" : "text-white/50"}`}
          style={{ cursor: "pointer" }}
        >
          Goals{" "}
          <span aria-hidden="true" style={{ fontSize: "0.65em" }}>
            ▼
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-header-bg border-header-border min-w-40">
          {sports.map((sport) => (
            <DropdownMenuLinkItem
              key={sport.id}
              className="px-4 py-2 text-header-text data-[highlighted]:bg-white/10 data-[highlighted]:text-white"
              render={
                <Link
                  to="/$sport/$year"
                  params={{ sport: sport.id, year: String(currentYear) }}
                  activeProps={{ className: "bg-white/15 text-white" }}
                />
              }
            >
              {sport.label}
            </DropdownMenuLinkItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Activities: a dropdown of the three coordinated views (Routes/Charts/List) —
          shown for everyone, incl. demo/logged-out. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={`nav-link ${isOnActivitiesGroup ? "active" : "text-white/50"}`}
          style={{ cursor: "pointer" }}
        >
          Activities{" "}
          <span aria-hidden="true" style={{ fontSize: "0.65em" }}>
            ▼
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="bg-header-bg border-header-border min-w-40">
          {ACTIVITIES_VIEWS.map((v) => (
            <DropdownMenuLinkItem
              key={v.to}
              className="px-4 py-2 text-header-text data-[highlighted]:bg-white/10 data-[highlighted]:text-white"
              render={
                <Link
                  to={v.to}
                  search={pickActivitiesGroupSearch}
                  activeProps={{ className: "bg-white/15 text-white" }}
                />
              }
            >
              {v.label}
            </DropdownMenuLinkItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
