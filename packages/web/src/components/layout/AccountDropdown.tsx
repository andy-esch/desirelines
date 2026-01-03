import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import type { User } from "../../hooks/useAuth";

interface AccountDropdownProps {
  user: User | null;
  loading?: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

const UserIcon = () => (
  <svg width="32" height="32" viewBox="0 0 20 20">
    {/* Light grey background */}
    <circle cx="10" cy="10" r="9.5" fill="#e2e8f0" />
    {/* Cyan face outline - flat top where hair meets */}
    <path
      d="M6 7.5 A4 4 0 1 0 14 7.5"
      fill="none"
      stroke="#00d4ff"
      strokeWidth="1"
      strokeLinecap="round"
    />
    {/* Hot pink flat-top hair - truly flat */}
    <path
      d="M5.5 7.5 L5.5 5 L14.5 5 L14.5 7.5"
      fill="none"
      stroke="#ff00ff"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Neon lime shirt/shoulders outline */}
    <path
      d="M4 17 C4 14 6.5 12.5 10 12.5 C13.5 12.5 16 14 16 17"
      fill="none"
      stroke="#39ff14"
      strokeWidth="1"
      strokeLinecap="round"
    />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
    <path
      fillRule="evenodd"
      d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"
    />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
    <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z" />
    <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z" />
  </svg>
);

const SignOutIcon = () => (
  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
    <path
      fillRule="evenodd"
      d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0z"
    />
    <path
      fillRule="evenodd"
      d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z"
    />
  </svg>
);

const SignInIcon = () => (
  <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
    <path
      fillRule="evenodd"
      d="M6 3.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v9a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 0-1 0v2A1.5 1.5 0 0 0 6.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2h-8A1.5 1.5 0 0 0 5 3.5v2a.5.5 0 0 0 1 0z"
    />
    <path
      fillRule="evenodd"
      d="M11.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 1 0-.708.708L10.293 7.5H1.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z"
    />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
  </svg>
);

/**
 * Account dropdown menu for the header
 *
 * Shows user information and auth controls in a dropdown:
 * - Authenticated: email, Strava status, Settings link, Sign Out
 * - Demo mode: "Not logged in", Sign In button
 */
export function AccountDropdown({
  user,
  loading = false,
  onSignIn,
  onSignOut,
}: AccountDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      } else if (event.key === "ArrowDown" && isOpen) {
        event.preventDefault();
        const firstItem = menuRef.current?.querySelector<HTMLElement>(
          'button:not(:disabled), a:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        firstItem?.focus();
      }
    },
    [isOpen]
  );

  // Handle menu item keyboard navigation
  const handleMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    );
    const currentIndex = items.indexOf(event.target as HTMLElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      items[nextIndex]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      items[prevIndex]?.focus();
    } else if (event.key === "Escape") {
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  }, []);

  const handleSignIn = async () => {
    setActionLoading(true);
    try {
      await onSignIn();
      setIsOpen(false);
    } catch {
      // Error handled by parent
    } finally {
      setActionLoading(false);
    }
  };

  const handleSignOut = async () => {
    setActionLoading(true);
    try {
      await onSignOut();
      setIsOpen(false);
    } catch {
      // Error handled by parent
    } finally {
      setActionLoading(false);
    }
  };

  const handleSettingsClick = () => {
    setIsOpen(false);
  };

  // Don't render anything while loading auth state
  if (loading) {
    return null;
  }

  const dropdownMenuStyle: React.CSSProperties = {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: "0.5rem",
    minWidth: "220px",
    backgroundColor: "var(--slate-dark, #2d3748)",
    border: "1px solid var(--slate, #4a5568)",
    borderRadius: "0.5rem",
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.3)",
    zIndex: 1050,
    overflow: "hidden",
  };

  const menuHeaderStyle: React.CSSProperties = {
    padding: "0.75rem 1rem",
    borderBottom: "1px solid var(--slate, #4a5568)",
  };

  const menuItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    padding: "0.625rem 1rem",
    border: "none",
    background: "transparent",
    color: "#e2e8f0",
    textAlign: "left",
    cursor: "pointer",
    textDecoration: "none",
    fontSize: "0.875rem",
    transition: "background-color 0.15s ease",
  };

  const menuItemHoverStyle = "rgba(255, 255, 255, 0.08)";

  return (
    <div ref={dropdownRef} className="position-relative" onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-link text-white d-flex align-items-center gap-1 p-1"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={user ? `Account menu for ${user.email}` : "Account menu"}
        style={{ textDecoration: "none" }}
      >
        <UserIcon />
        <ChevronDownIcon />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-orientation="vertical"
          style={dropdownMenuStyle}
          onKeyDown={handleMenuKeyDown}
        >
          {/* User Info Header */}
          <div style={menuHeaderStyle}>
            {user ? (
              <>
                <div
                  className="text-white small fw-medium"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "200px",
                  }}
                  title={user.email || undefined}
                >
                  {user.displayName || user.email}
                </div>
                {user.displayName && user.email && (
                  <div
                    className="text-white-50"
                    style={{
                      fontSize: "0.7rem",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "200px",
                    }}
                    title={user.email}
                  >
                    {user.email}
                  </div>
                )}
                <div
                  className="d-flex align-items-center gap-1 mt-1"
                  style={{ color: "#68d391", fontSize: "0.75rem" }}
                >
                  <CheckIcon />
                  <span>Connected to Strava</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-white small fw-medium">Not logged in</div>
                <div className="text-white-50" style={{ fontSize: "0.75rem" }}>
                  Demo version
                </div>
              </>
            )}
          </div>

          {/* Menu Items */}
          {user && (
            <Link
              to="/settings"
              role="menuitem"
              style={menuItemStyle}
              onClick={handleSettingsClick}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = menuItemHoverStyle)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <SettingsIcon />
              <span>Settings</span>
            </Link>
          )}

          <div style={{ borderTop: user ? "1px solid var(--slate, #4a5568)" : "none" }}>
            {user ? (
              <button
                type="button"
                role="menuitem"
                style={menuItemStyle}
                onClick={handleSignOut}
                disabled={actionLoading}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = menuItemHoverStyle)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <SignOutIcon />
                <span>{actionLoading ? "Signing out..." : "Sign Out"}</span>
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                style={{
                  ...menuItemStyle,
                  color: "var(--accent-cyan, #00d4ff)",
                }}
                onClick={handleSignIn}
                disabled={actionLoading}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = menuItemHoverStyle)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <SignInIcon />
                <span>{actionLoading ? "Signing in..." : "Sign In"}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
