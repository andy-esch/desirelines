import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useUserConfig } from "../hooks/useUserConfig";
import { SettingsSection } from "../components/settings/SettingsSection";
import { SettingRow } from "../components/settings/SettingRow";
import NeonSpinner from "../components/NeonSpinner";
import { pageBackgrounds } from "../styles/pageBackgrounds";
import type { Preferences } from "../types/generated/user_config";

const CheckIcon = () => (
  <svg width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
  </svg>
);

// Common timezones for the selector
const COMMON_TIMEZONES = [
  { value: "", label: "Browser Default" },
  { value: "America/New_York", label: "Eastern Time (US)" },
  { value: "America/Chicago", label: "Central Time (US)" },
  { value: "America/Denver", label: "Mountain Time (US)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US)" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Central European" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Asia/Shanghai", label: "China" },
  { value: "Australia/Sydney", label: "Sydney" },
];

const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  defaultYear: new Date().getFullYear(),
  distanceUnit: "miles",
  elevationUnit: "feet",
  defaultSport: "cycling",
  timezone: "",
};

export default function SettingsPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  // Load preferences
  const {
    data: preferences,
    updateData: updatePreferences,
    loading: prefsLoading,
    isSaving,
    saveError,
  } = useUserConfig("preferences", undefined, undefined, DEFAULT_PREFERENCES);

  // Local state for form values
  const [distanceUnit, setDistanceUnit] = useState(preferences?.distanceUnit || "miles");
  const [elevationUnit, setElevationUnit] = useState(preferences?.elevationUnit || "feet");
  const [timezone, setTimezone] = useState(preferences?.timezone || "");

  // Sync local state when preferences load
  useEffect(() => {
    if (preferences) {
      setDistanceUnit(preferences.distanceUnit || "miles");
      setElevationUnit(preferences.elevationUnit || "feet");
      setTimezone(preferences.timezone || "");
    }
  }, [preferences]);

  // Handle preference updates
  const handleDistanceUnitChange = async (value: string) => {
    setDistanceUnit(value);
    await updatePreferences({
      ...preferences,
      ...DEFAULT_PREFERENCES,
      distanceUnit: value,
      elevationUnit,
      timezone,
    });
  };

  const handleElevationUnitChange = async (value: string) => {
    setElevationUnit(value);
    await updatePreferences({
      ...preferences,
      ...DEFAULT_PREFERENCES,
      distanceUnit,
      elevationUnit: value,
      timezone,
    });
  };

  const handleTimezoneChange = async (value: string) => {
    setTimezone(value);
    await updatePreferences({
      ...preferences,
      ...DEFAULT_PREFERENCES,
      distanceUnit,
      elevationUnit,
      timezone: value,
    });
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  // Redirect unauthenticated users
  if (!authLoading && !user) {
    return <Navigate to="/" replace />;
  }

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

  return (
    <div className="flex-grow-1" style={{ background: pageBackgrounds.settings }}>
      <div className="container py-4" style={{ maxWidth: "800px" }}>
        <h1 className="h2 mb-4">Settings</h1>

        {/* Save error alert */}
        {saveError && (
          <div className="alert alert-danger mb-4" role="alert">
            {saveError.message}
          </div>
        )}

        {/* Display Settings */}
        <SettingsSection
          title="Display"
          description="Customize how data is displayed throughout the app"
        >
          <SettingRow label="Distance Unit" description="Used for all distance measurements">
            <select
              className="form-select form-select-sm"
              value={distanceUnit}
              onChange={(e) => handleDistanceUnitChange(e.target.value)}
              disabled={isSaving}
              style={{ width: "150px" }}
            >
              <option value="miles">Miles</option>
              <option value="kilometers">Kilometers</option>
            </select>
          </SettingRow>

          <SettingRow label="Elevation Unit" description="Used for elevation gain measurements">
            <select
              className="form-select form-select-sm"
              value={elevationUnit}
              onChange={(e) => handleElevationUnitChange(e.target.value)}
              disabled={isSaving}
              style={{ width: "150px" }}
            >
              <option value="feet">Feet</option>
              <option value="meters">Meters</option>
            </select>
          </SettingRow>

          <SettingRow label="Timezone" description={`Browser timezone: ${browserTimezone}`}>
            <select
              className="form-select form-select-sm"
              value={timezone}
              onChange={(e) => handleTimezoneChange(e.target.value)}
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

        {/* Account Section */}
        <SettingsSection title="Account">
          <SettingRow label="Email" readOnly>
            <span className="text-muted">{user?.email || "—"}</span>
          </SettingRow>

          <SettingRow label="Name" readOnly>
            <span className="text-muted">{user?.displayName || "—"}</span>
          </SettingRow>

          <SettingRow label="Connected Account" readOnly>
            <span className="d-flex align-items-center gap-1" style={{ color: "#68d391" }}>
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

        {/* Goal Management - Placeholder */}
        <SettingsSection title="Goals" description="Manage your goals across all sports and years">
          <p className="text-muted mb-0">
            Goal management table coming soon. For now, edit goals directly on each sport page.
          </p>
        </SettingsSection>

        {/* Saving indicator */}
        {isSaving && <div className="text-muted small text-end">Saving...</div>}
      </div>
    </div>
  );
}
