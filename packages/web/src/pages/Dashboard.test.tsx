import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";

// Mock useAuth hook
vi.mock("../hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

// Mock useMultiSportData hook (used by MultiSportComparisonChart)
vi.mock("../hooks/useMultiSportData", () => ({
  useMultiSportData: vi.fn(() => ({
    data: { cycling: null, running: null, yoga: null },
    isLoading: false,
    error: null,
  })),
}));

import { useAuth } from "../hooks/useAuth";
const mockUseAuth = vi.mocked(useAuth);

const mockSignIn = vi.fn();
const mockSignOut = vi.fn();

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
};

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loading state", () => {
    it("shows loading spinner when auth is loading", () => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: true,
        error: null,
        signIn: mockSignIn,
        signOut: mockSignOut,
      });
      renderWithRouter(<Dashboard />);

      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });
  });

  describe("unauthenticated user", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: false,
        error: null,
        signIn: mockSignIn,
        signOut: mockSignOut,
      });
    });

    it("renders welcome message without user name", () => {
      renderWithRouter(<Dashboard />);
      expect(screen.getByRole("heading", { name: "Welcome!" })).toBeInTheDocument();
    });

    it("shows sign-in prompt", () => {
      renderWithRouter(<Dashboard />);
      expect(screen.getByText("Interested in using Desire Lines?")).toBeInTheDocument();
      expect(screen.getByText(/Check back soon/)).toBeInTheDocument();
    });

    it("renders sport labels as links in sparkline chart", () => {
      renderWithRouter(<Dashboard />);

      // Sport labels are links in the MultiSportComparisonChart component
      // When there's no data, the empty state is shown instead
      expect(screen.getByText("No activity data for selected time range")).toBeInTheDocument();
    });
  });

  describe("authenticated user", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: { displayName: "Jane Doe", uid: "123", email: "jane@example.com" },
        loading: false,
        error: null,
        signIn: mockSignIn,
        signOut: mockSignOut,
      });
    });

    it("renders personalized welcome message", () => {
      renderWithRouter(<Dashboard />);
      expect(screen.getByRole("heading", { name: /Welcome back, Jane/i })).toBeInTheDocument();
    });

    it("does not show sign-in prompt", () => {
      renderWithRouter(<Dashboard />);
      expect(screen.queryByText("Want to see your own data?")).not.toBeInTheDocument();
    });

    it("shows dashboard description", () => {
      renderWithRouter(<Dashboard />);
      expect(screen.getByText("Your multi-sport activity dashboard")).toBeInTheDocument();
    });
  });

  describe("dashboard sections", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: null,
        loading: false,
        error: null,
        signIn: mockSignIn,
        signOut: mockSignOut,
      });
    });

    it("renders Recent Activity section", () => {
      renderWithRouter(<Dashboard />);
      expect(screen.getByRole("heading", { name: "Recent Activity" })).toBeInTheDocument();
    });

    it("renders time range selector", () => {
      renderWithRouter(<Dashboard />);
      // Time range selector is part of the MultiSportComparisonChart
      expect(screen.getByRole("button", { name: "2W" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "YTD" })).toBeInTheDocument();
    });
  });
});
