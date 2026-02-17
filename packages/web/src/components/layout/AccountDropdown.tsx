import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import type { User } from "../../hooks/useAuth";
import {
  CheckIcon,
  ChevronDownIcon,
  SettingsIcon,
  SignOutIcon,
  SignInIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
} from "../icons";
import { useTheme } from "../../contexts/ThemeContext";

interface AccountDropdownProps {
  user: User | null;
  loading?: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

/**
 * Custom 80s-style avatar icon (not shared - unique to this component)
 */
const UserIcon = () => (
  <svg width="28" height="28" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="9.5" fill="#e2e8f0" />
    <path
      d="M6 7.5 A4 4 0 1 0 14 7.5"
      fill="none"
      stroke="#00d4ff"
      strokeWidth="1"
      strokeLinecap="round"
    />
    <path
      d="M5.5 7.5 L5.5 5 L14.5 5 L14.5 7.5"
      fill="none"
      stroke="#ff00ff"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 17 C4 14 6.5 12.5 10 12.5 C13.5 12.5 16 14 16 17"
      fill="none"
      stroke="#39ff14"
      strokeWidth="1"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Account dropdown menu for the header
 *
 * Shows user information and auth controls in a dropdown:
 * - Authenticated: email, Strava status, Settings link, Sign Out
 * - Demo mode: "Not logged in", Settings link, Sign In button
 */
export function AccountDropdown({
  user,
  loading = false,
  onSignIn,
  onSignOut,
}: AccountDropdownProps) {
  const { theme, setTheme } = useTheme();
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
    backgroundColor: "var(--color-header-bg)",
    border: "1px solid var(--color-header-border)",
    borderRadius: "0.5rem",
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.3)",
    zIndex: 1050,
    overflow: "hidden",
  };

  const menuHeaderStyle: React.CSSProperties = {
    padding: "0.75rem 1rem",
    borderBottom: "1px solid var(--color-header-border)",
  };

  const menuItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    width: "100%",
    padding: "0.625rem 1rem",
    border: "none",
    color: "var(--color-header-text)",
    textAlign: "left",
    cursor: "pointer",
    textDecoration: "none",
    fontSize: "0.875rem",
  };

  return (
    <div ref={dropdownRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        className="bg-transparent border-0 text-white flex items-center gap-0.5 p-1 cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={user ? `Account menu for ${user.email}` : "Account menu"}
      >
        <UserIcon />
        <ChevronDownIcon size={10} className="opacity-60" />
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
                  className="text-white text-sm font-medium"
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
                    className="text-white/50"
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
                  className="flex items-center gap-1 mt-1"
                  style={{ color: "#68d391", fontSize: "0.75rem" }}
                >
                  <CheckIcon />
                  <span>Connected to Strava</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-white text-sm font-medium">Not logged in</div>
                <div className="text-white/50" style={{ fontSize: "0.75rem" }}>
                  Demo version
                </div>
              </>
            )}
          </div>

          {/* Menu Items */}
          <Link
            to="/settings"
            role="menuitem"
            className="transition-colors hover:bg-white/[0.08]"
            style={menuItemStyle}
            onClick={handleSettingsClick}
          >
            <SettingsIcon />
            <span>Settings</span>
          </Link>

          {/* Theme Toggle */}
          <div
            style={{
              borderTop: "1px solid var(--color-header-border)",
              padding: "0.375rem 1rem",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                color: "var(--color-header-text-muted)",
                marginBottom: "0.25rem",
                fontWeight: 500,
              }}
            >
              Theme
            </div>
            <div className="flex gap-0.5">
              {[
                { mode: "light" as const, icon: <SunIcon size={13} />, label: "Light" },
                { mode: "dark" as const, icon: <MoonIcon size={13} />, label: "Dark" },
                { mode: "system" as const, icon: <MonitorIcon size={13} />, label: "System" },
              ].map(({ mode, icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  role="menuitem"
                  onClick={() => setTheme(mode)}
                  title={label}
                  aria-label={`${label} theme`}
                  className="transition-colors"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                    padding: "0.25rem 0.5rem",
                    fontSize: "0.75rem",
                    border: "1px solid",
                    borderColor:
                      theme === mode ? "var(--color-header-accent)" : "var(--color-header-border)",
                    borderRadius: "0.25rem",
                    background: theme === mode ? "rgba(0, 212, 255, 0.15)" : "transparent",
                    color:
                      theme === mode
                        ? "var(--color-header-accent)"
                        : "var(--color-header-text-muted)",
                    cursor: "pointer",
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--color-header-border)" }}>
            {user ? (
              <button
                type="button"
                role="menuitem"
                className="transition-colors hover:bg-white/[0.08]"
                style={menuItemStyle}
                onClick={handleSignOut}
                disabled={actionLoading}
              >
                <SignOutIcon />
                <span>{actionLoading ? "Signing out..." : "Sign Out"}</span>
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="transition-colors hover:bg-white/[0.08]"
                style={{
                  ...menuItemStyle,
                  color: "var(--color-header-accent)",
                }}
                onClick={handleSignIn}
                disabled={actionLoading}
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
