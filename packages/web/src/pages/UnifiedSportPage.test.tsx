import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import UnifiedSportPage from "./UnifiedSportPage";

// Mock useAuth hook
vi.mock("../hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

// Mock child pages to avoid pulling in their full dependency trees
vi.mock("./SportPage", () => ({
  default: ({ sport }: { sport: string }) => <div data-testid="sport-page">SportPage:{sport}</div>,
}));

vi.mock("./DemoSportPage", () => ({
  default: ({ sport }: { sport: string }) => (
    <div data-testid="demo-sport-page">DemoSportPage:{sport}</div>
  ),
}));

import { useAuth } from "../hooks/useAuth";
const mockUseAuth = vi.mocked(useAuth);

const mockSignIn = vi.fn();
const mockSignOut = vi.fn();

describe("UnifiedSportPage", () => {
  const setupMockAuth = (overrides: Partial<ReturnType<typeof useAuth>> = {}) => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      error: null,
      signIn: mockSignIn,
      signOut: mockSignOut,
      ...overrides,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows skeleton loading screen while auth is loading", () => {
    setupMockAuth({ loading: true });

    const { container } = render(<UnifiedSportPage sport="cycling" />);

    // SportPageSkeleton renders react-loading-skeleton elements
    expect(container.querySelectorAll(".react-loading-skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("sport-page")).not.toBeInTheDocument();
    expect(screen.queryByTestId("demo-sport-page")).not.toBeInTheDocument();
  });

  it("renders SportPage for authenticated users", () => {
    setupMockAuth({
      user: { displayName: "Jane", uid: "123", email: "jane@example.com" },
    });

    render(<UnifiedSportPage sport="running" />);

    expect(screen.getByTestId("sport-page")).toBeInTheDocument();
    expect(screen.getByText("SportPage:running")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-sport-page")).not.toBeInTheDocument();
  });

  it("renders DemoSportPage for unauthenticated users", () => {
    setupMockAuth();

    render(<UnifiedSportPage sport="yoga" />);

    expect(screen.getByTestId("demo-sport-page")).toBeInTheDocument();
    expect(screen.getByText("DemoSportPage:yoga")).toBeInTheDocument();
    expect(screen.queryByTestId("sport-page")).not.toBeInTheDocument();
  });
});
