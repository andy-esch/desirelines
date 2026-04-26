import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import SettingsPage from "./SettingsPage";
import { renderWithRouter } from "../test/renderWithRouter";

// Mock hooks
vi.mock("../hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../hooks/useUserProfile", () => ({
  useUserProfile: vi.fn(),
}));

vi.mock("../hooks/useUserConfig", () => ({
  useUserConfig: vi.fn(),
}));

// Mock child components that have their own complex state
vi.mock("../components/settings/SportVisibilitySettings", () => ({
  SportVisibilitySettings: () => <div data-testid="sport-visibility-settings" />,
}));

vi.mock("../components/settings/GoalManagementTable", () => ({
  GoalManagementTable: () => <div data-testid="goal-management-table" />,
}));

import { useAuth } from "../hooks/useAuth";
import { useUserProfile } from "../hooks/useUserProfile";
import { useUserConfig } from "../hooks/useUserConfig";

const mockUseAuth = vi.mocked(useAuth);
const mockUseUserProfile = vi.mocked(useUserProfile);
const mockUseUserConfig = vi.mocked(useUserConfig);

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // SettingsSection uses useReducedMotion (matchMedia) and ResizeObserver
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  });

  it("shows loading spinner while data is loading", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseUserProfile.mockReturnValue({
      displayName: "Guest",
      loading: true,
      profile: null,
      error: null,
    });
    mockUseUserConfig.mockReturnValue({
      data: null,
      updateData: vi.fn(),
      loading: true,
      error: null,
      isSaving: false,
      saveError: null,
      clearSaveError: vi.fn(),
    });

    await renderWithRouter(<SettingsPage />);

    // NeonSpinner renders a div with role="status"
    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    // Should not render settings heading while loading
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("renders settings page for unauthenticated user", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseUserProfile.mockReturnValue({
      displayName: "Guest",
      loading: false,
      profile: null,
      error: null,
    });
    mockUseUserConfig.mockReturnValue({
      data: null,
      updateData: vi.fn(),
      loading: false,
      error: null,
      isSaving: false,
      saveError: null,
      clearSaveError: vi.fn(),
    });

    await renderWithRouter(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    // No user card for unauthenticated
    expect(screen.queryByText("Authenticated Athlete")).not.toBeInTheDocument();
  });

  it("renders user card for authenticated user", async () => {
    mockUseAuth.mockReturnValue({
      user: { uid: "u1", email: "a@b.com", displayName: "Jane", photoURL: null },
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseUserProfile.mockReturnValue({
      displayName: "Jane Doe",
      loading: false,
      profile: { strava_athlete_id: 123, first_name: "Jane", last_name: "Doe" },
      error: null,
    });
    mockUseUserConfig.mockReturnValue({
      data: null,
      updateData: vi.fn(),
      loading: false,
      error: null,
      isSaving: false,
      saveError: null,
      clearSaveError: vi.fn(),
    });

    await renderWithRouter(<SettingsPage />);

    expect(screen.getByText("Authenticated Athlete")).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
  });

  it("renders display settings section", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseUserProfile.mockReturnValue({
      displayName: "Guest",
      loading: false,
      profile: null,
      error: null,
    });
    mockUseUserConfig.mockReturnValue({
      data: null,
      updateData: vi.fn(),
      loading: false,
      error: null,
      isSaving: false,
      saveError: null,
      clearSaveError: vi.fn(),
    });

    await renderWithRouter(<SettingsPage />);

    expect(screen.getByText("Display")).toBeInTheDocument();
    expect(screen.getByText("Distance Unit")).toBeInTheDocument();
    expect(screen.getByText("Elevation Unit")).toBeInTheDocument();
    expect(screen.getByText("Timezone")).toBeInTheDocument();
  });

  it("renders sport visibility and goals sections", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseUserProfile.mockReturnValue({
      displayName: "Guest",
      loading: false,
      profile: null,
      error: null,
    });
    mockUseUserConfig.mockReturnValue({
      data: null,
      updateData: vi.fn(),
      loading: false,
      error: null,
      isSaving: false,
      saveError: null,
      clearSaveError: vi.fn(),
    });

    await renderWithRouter(<SettingsPage />);

    expect(screen.getByText("Visible Sports")).toBeInTheDocument();
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.getByTestId("sport-visibility-settings")).toBeInTheDocument();
    expect(screen.getByTestId("goal-management-table")).toBeInTheDocument();
  });
});
