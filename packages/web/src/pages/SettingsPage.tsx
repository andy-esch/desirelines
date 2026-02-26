import { useState, useCallback, useEffect } from "react";
import { useLocation } from "@tanstack/react-router";
import { useAuth } from "../hooks/useAuth";
import { useUserProfile } from "../hooks/useUserProfile";
import { useUserConfig } from "../hooks/useUserConfig";
import { SettingsSection } from "../components/settings/SettingsSection";
import { SettingRow } from "../components/settings/SettingRow";
import { GoalManagementTable } from "../components/settings/GoalManagementTable";
import { SportVisibilitySettings } from "../components/settings/SportVisibilitySettings";
import { CheckIcon } from "../components/icons";
import NeonSpinner from "../components/NeonSpinner";
import { InlineAlert } from "../components/InlineAlert";
import { NarrowPageLayout } from "../components/layout/PageLayout";
import {
  COMMON_TIMEZONES,
  DEFAULT_PREFERENCES,
  DISTANCE_UNIT_OPTIONS,
  ELEVATION_UNIT_OPTIONS,
} from "../constants/settings";
import type { Preferences } from "../types/generated/user_config";

/**
 * Custom 80s-style avatar icon for the settings page
 */
const LargeUserAvatar = () => (
  <div className="relative w-24 h-24 md:w-32 md:h-32 flex-shrink-0">
    <svg width="100%" height="100%" viewBox="0 0 40 40" className="drop-shadow-lg">
      <circle
        cx="20"
        cy="20"
        r="19"
        fill="var(--color-slate-dark)"
        stroke="var(--color-slate)"
        strokeWidth="1"
      />
      <path
        d="M12 15 A8 8 0 1 0 28 15"
        fill="none"
        stroke="var(--color-neon-cyan)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M11 15 L11 10 L29 10 L29 15"
        fill="none"
        stroke="var(--color-neon-magenta)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 34 C8 27 13 24 20 24 C27 24 32 27 32 34"
        fill="none"
        stroke="var(--color-neon-green)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
    <div className="absolute -bottom-1 -right-1 bg-success rounded-full p-1 border-2 border-slate-dark shadow-[0_0_10px_var(--color-success)]">
      <CheckIcon size={12} className="text-slate-dark" />
    </div>
  </div>
);

export default function SettingsPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { displayName, loading: profileLoading } = useUserProfile();
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();

  const {
    data: preferences,
    updateData: updatePreferences,
    loading: prefsLoading,
    isSaving,
    saveError,
    clearSaveError,
  } = useUserConfig("preferences", undefined, undefined, DEFAULT_PREFERENCES);

  // Scroll to anchor (e.g., #sport-visibility) after page loads
  useEffect(() => {
    if (authLoading || prefsLoading) return;
    const hash = location.hash.replace("#", "");
    if (hash) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        const element = document.getElementById(hash);
        element?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [location.hash, authLoading, prefsLoading]);

  // Single handler for all preference updates
  const handlePreferenceChange = useCallback(
    async (field: keyof Preferences, value: string | number) => {
      const updated: Preferences = {
        ...DEFAULT_PREFERENCES,
        ...preferences,
        [field]: value,
      };
      await updatePreferences(updated);
    },
    [preferences, updatePreferences]
  );

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }, [signOut]);

  // Note: Settings page works for both authenticated users (Firestore) and
  // demo mode (localStorage) - no redirect needed

  // Show loading state
  if (authLoading || prefsLoading || profileLoading) {
    return (
      <NarrowPageLayout background="settings">
        <div className="flex justify-center items-center" style={{ minHeight: "60vh" }}>
          <NeonSpinner />
        </div>
      </NarrowPageLayout>
    );
  }

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Use preferences directly - no local state duplication needed
  const currentPrefs = preferences ?? DEFAULT_PREFERENCES;

  return (
    <NarrowPageLayout background="settings">
      <h1 className="h2 mb-3 font-display">Settings</h1>

      {saveError && (
        <InlineAlert className="mb-6" onDismiss={clearSaveError}>
          {saveError.message}
        </InlineAlert>
      )}

      {user && (
        <div className="card mb-8 overflow-hidden neon-backdrop">
          <div className="card-body p-6 md:p-8">
            <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
              <LargeUserAvatar />

              <div className="flex-grow text-center md:text-left">
                <div className="mb-1 text-slate-lighter text-sm uppercase tracking-widest font-bold">
                  Authenticated Athlete
                </div>
                <h2 className="h3 mb-2 text-white font-display neon-gradient-text">
                  {displayName}
                </h2>

                <div className="flex flex-col gap-2 mt-4">
                  <div className="flex items-center justify-center md:justify-start gap-2 text-slate-light text-sm">
                    <span className="w-2 h-2 rounded-full bg-success shadow-[0_0_8px_var(--color-success)]"></span>
                    Connected to Strava
                  </div>

                  <a
                    href={`https://www.strava.com/athletes/${user.uid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center md:justify-start gap-1 text-accent-cyan hover:underline text-sm font-medium"
                  >
                    View Strava Profile
                    <span className="text-xs">↗</span>
                  </a>
                </div>
              </div>

              <div className="flex-shrink-0 self-center md:self-start">
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  onClick={handleSignOut}
                  disabled={signingOut}
                >
                  {signingOut ? "Signing out..." : "Sign Out"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <SettingsSection
        title="Display"
        description="Customize how data is displayed throughout the app"
      >
        <SettingRow label="Distance Unit" description="Used for all distance measurements">
          {(descriptionId, inputId) => (
            <select
              id={inputId}
              className="form-select form-select-sm"
              value={currentPrefs.distanceUnit || "miles"}
              onChange={(e) => handlePreferenceChange("distanceUnit", e.target.value)}
              disabled={isSaving}
              aria-describedby={descriptionId}
              style={{ width: "150px" }}
            >
              {DISTANCE_UNIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </SettingRow>

        <SettingRow label="Elevation Unit" description="Used for elevation gain measurements">
          {(descriptionId, inputId) => (
            <select
              id={inputId}
              className="form-select form-select-sm"
              value={currentPrefs.elevationUnit || "feet"}
              onChange={(e) => handlePreferenceChange("elevationUnit", e.target.value)}
              disabled={isSaving}
              aria-describedby={descriptionId}
              style={{ width: "150px" }}
            >
              {ELEVATION_UNIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </SettingRow>

        <SettingRow label="Timezone" description={`Browser timezone: ${browserTimezone}`}>
          {(descriptionId, inputId) => (
            <select
              id={inputId}
              className="form-select form-select-sm"
              value={currentPrefs.timezone || ""}
              onChange={(e) => handlePreferenceChange("timezone", e.target.value)}
              disabled={isSaving}
              aria-describedby={descriptionId}
              style={{ width: "200px" }}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          )}
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Visible Sports"
        description="Choose which sports appear in your dashboard and navigation"
        id="sport-visibility"
      >
        <SportVisibilitySettings />
      </SettingsSection>

      <SettingsSection title="Goals" description="Manage your goals across all sports and years">
        <GoalManagementTable />
      </SettingsSection>

      {isSaving && <div className="text-slate-light text-sm text-right">Saving...</div>}
    </NarrowPageLayout>
  );
}
