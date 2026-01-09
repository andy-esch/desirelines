import { Link, useLocation } from "react-router-dom";
import Logo from "../Logo";
import { useAuth } from "../../hooks/useAuth";
import { AccountDropdown } from "./AccountDropdown";
import Navigation from "./Navigation";

const SPORT_ROUTES = ["/cycling", "/running", "/yoga"];

const HamburgerIcon = () => (
  <svg width="24" height="24" fill="currentColor" viewBox="0 0 16 16">
    <path
      fillRule="evenodd"
      d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"
    />
  </svg>
);

const GearIcon = () => (
  <svg width="22" height="22" fill="currentColor" viewBox="0 0 16 16">
    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
  </svg>
);

export default function Header() {
  const location = useLocation();
  const { user, loading, signIn, signOut } = useAuth();

  // Show controls toggle only on sport detail pages
  const showControlsToggle = SPORT_ROUTES.some((route) => location.pathname.startsWith(route));

  const currentDate = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <header
      className="navbar sticky-top flex-md-nowrap p-2 shadow"
      style={{ backgroundColor: "var(--slate-dark, #2d3748)" }}
    >
      <Link to="/" className="logo-link me-0 px-2 d-flex align-items-center">
        <div style={{ transform: "translateY(-1px)" }}>
          <Logo />
        </div>
      </Link>

      {/* Desktop navigation */}
      <Navigation className="d-none d-md-flex ms-3" />

      <div className="d-none d-md-flex align-items-center gap-3 px-3 ms-auto">
        <div className="navbar-text text-white-50 small d-none d-lg-block">{currentDate}</div>
        <AccountDropdown user={user} loading={loading} onSignIn={signIn} onSignOut={signOut} />
      </div>

      {/* Mobile: hamburger, controls gear, and account dropdown on right */}
      <div className="d-md-none ms-auto d-flex align-items-center gap-1">
        <button
          className="navbar-toggler border-0 text-white"
          type="button"
          data-bs-toggle="offcanvas"
          data-bs-target="#mobileNavMenu"
          aria-controls="mobileNavMenu"
          aria-expanded="false"
          aria-label="Toggle navigation"
        >
          <HamburgerIcon />
        </button>
        {showControlsToggle && (
          <button
            className="navbar-toggler border-0 text-white"
            type="button"
            data-bs-toggle="offcanvas"
            data-bs-target="#sidebarMenu"
            aria-controls="sidebarMenu"
            aria-expanded="false"
            aria-label="Toggle controls"
          >
            <GearIcon />
          </button>
        )}
        <AccountDropdown user={user} loading={loading} onSignIn={signIn} onSignOut={signOut} />
      </div>

      {/* Mobile Navigation Drawer (slides from left) */}
      <div
        className="offcanvas offcanvas-start d-md-none"
        tabIndex={-1}
        id="mobileNavMenu"
        aria-labelledby="mobileNavMenuLabel"
        style={{ backgroundColor: "#2d3748", maxWidth: "280px" }}
      >
        <div className="offcanvas-header">
          <h5 className="offcanvas-title text-white" id="mobileNavMenuLabel">
            Navigation
          </h5>
          <button
            type="button"
            className="btn-close btn-close-white"
            data-bs-dismiss="offcanvas"
            aria-label="Close"
          ></button>
        </div>
        <div className="offcanvas-body">
          <Navigation vertical className="mb-4" />
        </div>
      </div>
    </header>
  );
}
