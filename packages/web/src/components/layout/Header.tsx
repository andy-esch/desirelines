import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetClose, SheetTitle } from "@/components/ui/sheet";
import Logo from "../Logo";
import { useAuth } from "../../hooks/useAuth";
import { AccountDropdown } from "./AccountDropdown";
import Navigation from "./Navigation";
import { CloseIconLg, SettingsIcon } from "../icons";
import { useUIState } from "../../contexts/UIStateContext";

/** Non-sport first-level routes — anything else is a sport detail page */
const PAGE_ROUTES = new Set(["", "dashboard", "activities", "routes", "origins", "settings"]);

const HamburgerIcon = () => (
  <svg width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
    <path
      fillRule="evenodd"
      d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"
    />
  </svg>
);

interface HeaderProps {
  scrolled?: boolean;
}

export default function Header({ scrolled = false }: HeaderProps) {
  const location = useLocation();
  const { user, loading, signIn, signOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const { toggleMobileSidebar } = useUIState();

  // Close mobile nav drawer on route change (adjust state during render)
  const [prevPathname, setPrevPathname] = useState(location.pathname);
  if (location.pathname !== prevPathname) {
    setPrevPathname(location.pathname);
    setNavOpen(false);
  }

  // Show controls toggle on sport detail pages (any sport, authenticated or demo)
  const segments = location.pathname.split("/").filter(Boolean);
  const firstSegment = segments[0] || "";
  const showControlsToggle =
    !PAGE_ROUTES.has(firstSegment) || // /:sport or /:sport/:year
    (firstSegment === "demo" && segments.length >= 2); // /demo/:sport/...

  const currentDate = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <header
      className={`sticky top-0 flex items-center flex-nowrap px-2 py-2 transition-shadow duration-200 ${scrolled ? "shadow-lg" : ""}`}
      style={{
        backgroundColor: "var(--color-header-bg)",
        zIndex: 40,
      }}
    >
      <Link to="/" className="logo-link px-2 flex items-center shrink-0 no-underline">
        <Logo fontSize="1.25rem" />
      </Link>

      {/* Desktop navigation — only at lg+ where there's room */}
      <Navigation className="hidden lg:flex ms-4" />

      <div className="hidden lg:flex items-center gap-3 ms-auto pe-2">
        <span className="text-white/50 text-xs whitespace-nowrap">{currentDate}</span>
        <AccountDropdown user={user} loading={loading} onSignIn={signIn} onSignOut={signOut} />
      </div>

      {/* Mobile/tablet: hamburger, controls gear, and account dropdown on right */}
      <div className="lg:hidden ms-auto flex items-center">
        <button
          className="btn-icon"
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Toggle navigation"
        >
          <HamburgerIcon />
        </button>
        {showControlsToggle && (
          <button
            className="btn-icon"
            type="button"
            onClick={toggleMobileSidebar}
            aria-label="Toggle controls"
          >
            <SettingsIcon size={22} />
          </button>
        )}
        <AccountDropdown user={user} loading={loading} onSignIn={signIn} onSignOut={signOut} />
      </div>

      {/* Mobile Navigation Drawer */}
      <Sheet open={navOpen} onOpenChange={(open) => !open && setNavOpen(false)}>
        <SheetContent side="left" className="max-w-[280px] w-[80vw] bg-header-bg">
          <div className="flex items-center justify-between p-4">
            <SheetTitle className="text-white m-0">Navigation</SheetTitle>
            <SheetClose className="bg-transparent border-0 text-white p-1" aria-label="Close">
              <CloseIconLg />
            </SheetClose>
          </div>
          <div className="p-4">
            <Navigation vertical className="mb-6" />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
