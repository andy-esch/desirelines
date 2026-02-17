import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Dialog, DialogPanel, Transition, TransitionChild } from "@headlessui/react";
import Logo from "../Logo";
import { useAuth } from "../../hooks/useAuth";
import { AccountDropdown } from "./AccountDropdown";
import Navigation from "./Navigation";
import { CloseIconLg, SettingsIcon } from "../icons";
import { useUIState } from "../../contexts/UIStateContext";

/** Non-sport first-level routes — anything else is a sport detail page */
const PAGE_ROUTES = new Set(["", "dashboard", "activities", "origins", "settings"]);

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

  // Close mobile nav drawer on route change
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

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
      <Transition show={navOpen}>
        <Dialog onClose={() => setNavOpen(false)} className="relative" style={{ zIndex: 50 }}>
          {/* Backdrop */}
          <TransitionChild
            enter="transition-opacity duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/50" aria-hidden="true" />
          </TransitionChild>

          {/* Slide-in panel */}
          <TransitionChild
            enter="transition-transform duration-200"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="transition-transform duration-150"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
          >
            <DialogPanel
              className="fixed inset-y-0 left-0 flex flex-col overflow-y-auto"
              style={{
                backgroundColor: "var(--color-header-bg)",
                maxWidth: "280px",
                width: "80vw",
              }}
            >
              <div className="flex items-center justify-between p-4">
                <h5 className="text-white m-0">Navigation</h5>
                <button
                  type="button"
                  className="bg-transparent border-0 text-white p-1"
                  onClick={() => setNavOpen(false)}
                  aria-label="Close"
                >
                  <CloseIconLg />
                </button>
              </div>
              <div className="p-4">
                <Navigation vertical className="mb-6" />
              </div>
            </DialogPanel>
          </TransitionChild>
        </Dialog>
      </Transition>
    </header>
  );
}
