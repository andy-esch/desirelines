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
      expect(screen.getByText("Want to see your own data?")).toBeInTheDocument();
      expect(screen.getByText(/Sign in with Google/)).toBeInTheDocument();
    });

    it("renders all three sport cards", () => {
      renderWithRouter(<Dashboard />);

      expect(screen.getByRole("heading", { name: /cycling/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /running/i })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /yoga/i })).toBeInTheDocument();
    });

    it("renders View Details links for each sport", () => {
      renderWithRouter(<Dashboard />);
      const viewDetailsLinks = screen.getAllByRole("link", { name: /View Details/i });
      expect(viewDetailsLinks).toHaveLength(3);
    });

    it("links to current year for each sport", () => {
      const currentYear = new Date().getFullYear();
      renderWithRouter(<Dashboard />);

      const links = screen.getAllByRole("link", { name: /View Details/i });
      expect(links[0]).toHaveAttribute("href", `/cycling/${currentYear}`);
      expect(links[1]).toHaveAttribute("href", `/running/${currentYear}`);
      expect(links[2]).toHaveAttribute("href", `/yoga/${currentYear}`);
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

    it("renders Your Sports section", () => {
      renderWithRouter(<Dashboard />);
      expect(screen.getByRole("heading", { name: "Your Sports" })).toBeInTheDocument();
    });
  });
});
