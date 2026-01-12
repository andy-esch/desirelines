import { useState, useCallback } from "react";
import { useAuth } from "../hooks/useAuth";
import { useUserConfig } from "../hooks/useUserConfig";
import { SettingsSection } from "../components/settings/SettingsSection";
import { SettingRow } from "../components/settings/SettingRow";
import { GoalManagementTable } from "../components/settings/GoalManagementTable";
import { SportVisibilitySettings } from "../components/settings/SportVisibilitySettings";
import { CheckIcon } from "../components/icons";
import NeonSpinner from "../components/NeonSpinner";
import { pageBackgrounds } from "../styles/pageBackgrounds";
import {
  COMMON_TIMEZONES,
  DEFAULT_PREFERENCES,
  DISTANCE_UNIT_OPTIONS,
  ELEVATION_UNIT_OPTIONS,
} from "../constants/settings";
import type { Preferences } from "../types/generated/user_config";

export default function SettingsPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const {
    data: preferences,
    updateData: updatePreferences,
    loading: prefsLoading,
    isSaving,
    saveError,
  } = useUserConfig("preferences", undefined, undefined, DEFAULT_PREFERENCES);

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
  if (authLoading || prefsLoading) {
    return (
      <div
        className="flex-grow-1 d-flex justify-content-center align-items-center"
        style={{ background: pageBackgrounds.settings }}
      >
        <NeonSpinner />
      </div>
    );
  }

  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Use preferences directly - no local state duplication needed
  const currentPrefs = preferences ?? DEFAULT_PREFERENCES;

  return (
    <div className="flex-grow-1" style={{ background: pageBackgrounds.settings }}>
      <div className="container py-4" style={{ maxWidth: "800px" }}>
        <h1 className="h2 mb-4">Settings</h1>

        {saveError && (
          <div className="alert alert-danger mb-4" role="alert">
            {saveError.message}
          </div>
        )}

        <SettingsSection
          title="Display"
          description="Customize how data is displayed throughout the app"
        >
          <SettingRow label="Distance Unit" description="Used for all distance measurements">
            <select
              className="form-select form-select-sm"
              value={currentPrefs.distanceUnit || "miles"}
              onChange={(e) => handlePreferenceChange("distanceUnit", e.target.value)}
              disabled={isSaving}
              style={{ width: "150px" }}
            >
              {DISTANCE_UNIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow label="Elevation Unit" description="Used for elevation gain measurements">
            <select
              className="form-select form-select-sm"
              value={currentPrefs.elevationUnit || "feet"}
              onChange={(e) => handlePreferenceChange("elevationUnit", e.target.value)}
              disabled={isSaving}
              style={{ width: "150px" }}
            >
              {ELEVATION_UNIT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow label="Timezone" description={`Browser timezone: ${browserTimezone}`}>
            <select
              className="form-select form-select-sm"
              value={currentPrefs.timezone || ""}
              onChange={(e) => handlePreferenceChange("timezone", e.target.value)}
              disabled={isSaving}
              style={{ width: "200px" }}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </select>
          </SettingRow>
        </SettingsSection>

        <SettingsSection
          title="Visible Sports"
          description="Choose which sports appear in your dashboard and navigation"
        >
          <SportVisibilitySettings />
        </SettingsSection>

        {user && (
          <SettingsSection title="Account">
            <SettingRow label="Email" readOnly>
              <span className="text-muted">{user.email || "—"}</span>
            </SettingRow>

            <SettingRow label="Name" readOnly>
              <span className="text-muted">{user.displayName || "—"}</span>
            </SettingRow>

            <SettingRow label="Connected Account" readOnly>
              <span
                className="d-flex align-items-center gap-1"
                style={{ color: "var(--bs-success, #68d391)" }}
              >
                <CheckIcon />
                Strava
              </span>
            </SettingRow>

            <div className="pt-3">
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                onClick={handleSignOut}
                disabled={signingOut}
              >
                {signingOut ? "Signing out..." : "Sign Out"}
              </button>
            </div>
          </SettingsSection>
        )}

        <SettingsSection title="Goals" description="Manage your goals across all sports and years">
          <GoalManagementTable />
        </SettingsSection>

        {isSaving && <div className="text-muted small text-end">Saving...</div>}
      </div>
    </div>
  );
}
