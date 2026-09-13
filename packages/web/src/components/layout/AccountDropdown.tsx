import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import type { User } from "../../hooks/useAuth";
import { useUserProfile } from "../../hooks/useUserProfile";
import { tint } from "../../utils/colorTokens";
import {
  CheckIcon,
  ChevronDownIcon,
  SettingsIcon,
  SignOutIcon,
  SignInIcon,
  MonitorIcon,
} from "../icons";
import { useTheme } from "../../contexts/ThemeContext";
import { VISIBLE_THEMES, type ThemePreference } from "../../themes/registry";

// Focusable menu items for arrow-key navigation: enabled buttons/links and
// anything explicitly tab-focusable. Shared by the querySelector (first item)
// and querySelectorAll (all items) navigation handlers below.
const MENU_ITEM_SELECTOR =
  'button:not(:disabled), a:not(:disabled), [tabindex]:not([tabindex="-1"])';

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
    <circle cx="10" cy="10" r="9.5" fill="var(--color-header-text)" />
    <path
      d="M6 7.5 A4 4 0 1 0 14 7.5"
      fill="none"
      stroke="var(--color-brand-cyan)"
      strokeWidth="1"
      strokeLinecap="round"
    />
    <path
      d="M5.5 7.5 L5.5 5 L14.5 5 L14.5 7.5"
      fill="none"
      stroke="var(--color-neon-magenta)"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 17 C4 14 6.5 12.5 10 12.5 C13.5 12.5 16 14 16 17"
      fill="none"
      stroke="var(--color-neon-lime)"
      strokeWidth="1"
      strokeLinecap="round"
    />
  </svg>
);

/** Picker preview: the theme's ground with its accent colors as dots. */
const ThemeSwatch = ({ colors }: { colors: readonly string[] }) => {
  const [ground, ...accents] = colors;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "2px",
        padding: "3px 4px",
        borderRadius: "3px",
        background: ground,
        border: "1px solid var(--color-header-border)",
      }}
    >
      {accents.map((color) => (
        <span
          key={color}
          style={{ width: "5px", height: "5px", borderRadius: "50%", background: color }}
        />
      ))}
    </span>
  );
};

const THEME_OPTIONS: readonly { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  ...VISIBLE_THEMES.map((t) => ({
    value: t.id,
    label: t.label,
    icon: <ThemeSwatch colors={t.swatches} />,
  })),
  { value: "system", label: "System", icon: <MonitorIcon size={13} /> },
];

/**
 * Account dropdown menu for the header
 *
 * Shows user information and auth controls in a dropdown:
 * - Authenticated: display name, Strava status, Settings link, Sign Out
 * - Demo mode: "Not logged in", Settings link, Sign In button
 */
export function AccountDropdown({
  user,
  loading: authLoading = false,
  onSignIn,
  onSignOut,
}: AccountDropdownProps) {
  const { preference, setPreference } = useTheme();
  const { displayName, loading: profileLoading } = useUserProfile();
  const [isOpen, setIsOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const loading = authLoading || (!!user && profileLoading);

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
      } else if (event.key === "ArrowDown" && isOpen && event.target === triggerRef.current) {
        // Only "arrow into the menu" from the trigger. Without the target guard
        // this also fires as ArrowDown bubbles up from a focused menu item (see
        // handleMenuKeyDown, which doesn't stopPropagation), resetting focus to
        // the first item and making it impossible to navigate past it.
        event.preventDefault();
        const firstItem = menuRef.current?.querySelector<HTMLElement>(MENU_ITEM_SELECTOR);
        firstItem?.focus();
      }
    },
    [isOpen]
  );

  // Handle menu item keyboard navigation
  const handleMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
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

  // Sign-in and sign-out share the same choreography: flag the pending state,
  // run the parent-provided auth action, close the menu on success, and always
  // clear the pending flag. Errors are surfaced by the parent, so swallow here.
  const runAuthAction = async (action: () => Promise<void>) => {
    setActionLoading(true);
    try {
      await action();
      setIsOpen(false);
    } catch {
      // Error handled by parent
    } finally {
      setActionLoading(false);
    }
  };

  const handleSignIn = () => runAuthAction(onSignIn);
  const handleSignOut = () => runAuthAction(onSignOut);

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
    <div ref={dropdownRef} className="relative" onKeyDown={handleKeyDown} role="presentation">
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        className="bg-transparent border-0 text-header-ink flex items-center gap-0.5 p-1 cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={user ? `Account menu for ${displayName}` : "Account menu"}
      >
        <UserIcon />
        <ChevronDownIcon size={10} className="opacity-60" />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-orientation="vertical"
          style={dropdownMenuStyle}
          onKeyDown={handleMenuKeyDown}
        >
          {/* User Info Header */}
          <div style={menuHeaderStyle}>
            {user ? (
              <>
                <div
                  className="text-header-ink text-sm font-medium"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "200px",
                  }}
                >
                  {displayName}
                </div>
                <div
                  className="flex items-center gap-1 mt-1"
                  style={{ color: "var(--color-success)", fontSize: "0.75rem" }}
                >
                  <CheckIcon />
                  <span>Connected to Strava</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-header-ink text-sm font-medium">Not logged in</div>
                <div className="text-header-ink/50" style={{ fontSize: "0.75rem" }}>
                  Demo version
                </div>
              </>
            )}
          </div>

          {/* Menu Items */}
          <Link
            to="/settings"
            role="menuitem"
            className="transition-colors hover:bg-header-ink/[0.08]"
            style={menuItemStyle}
            onClick={handleSettingsClick}
          >
            <SettingsIcon />
            <span>Settings</span>
          </Link>

          {/* Theme picker */}
          <div
            style={{
              borderTop: "1px solid var(--color-header-border)",
              padding: "0.375rem 0",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                color: "var(--color-header-text-muted)",
                margin: "0 1rem 0.25rem",
                fontWeight: 500,
              }}
            >
              Theme
            </div>
            {/* menuitemradio + aria-checked, not menuitem: these are a single-select
                group, so the active theme must be exposed programmatically — the
                background/check treatment below conveys it to sighted users only.
                A vertical list rather than a segmented row, so it scales with the
                number of released themes. */}
            <div role="group" aria-label="Theme">
              {THEME_OPTIONS.map(({ value, label, icon }) => {
                const checked = preference === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    onClick={() => setPreference(value)}
                    aria-label={`${label} theme`}
                    className="bg-transparent transition-colors hover:bg-header-ink/[0.08]"
                    style={{
                      ...menuItemStyle,
                      padding: "0.375rem 1rem",
                      fontSize: "0.8125rem",
                      // Inline only when checked, so the hover class still applies to the
                      // rest. brand-cyan, not accent-cyan-glow: this dropdown lives in the
                      // header, which is pinned dark, so it must not flip with the theme.
                      ...(checked && { background: tint("--color-brand-cyan", 15) }),
                      color: checked
                        ? "var(--color-header-accent)"
                        : "var(--color-header-text-muted)",
                    }}
                  >
                    {icon}
                    <span className="grow">{label}</span>
                    {checked && <CheckIcon />}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--color-header-border)" }}>
            {user ? (
              <button
                type="button"
                role="menuitem"
                className="transition-colors hover:bg-header-ink/[0.08]"
                style={menuItemStyle}
                onClick={() => void handleSignOut()}
                disabled={actionLoading}
              >
                <SignOutIcon />
                <span>{actionLoading ? "Signing out..." : "Sign Out"}</span>
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="transition-colors hover:bg-header-ink/[0.08]"
                style={{
                  ...menuItemStyle,
                  color: "var(--color-header-accent)",
                }}
                onClick={() => void handleSignIn()}
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
