import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import RoutesPage from "./RoutesPage";
import { renderWithRouter } from "../test/renderWithRouter";

// Mock hooks
vi.mock("../hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../hooks/useRouteData", () => ({
  useRouteData: vi.fn(),
}));

vi.mock("../hooks/useUserConfig", () => ({
  useUserConfig: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
}));

// Mock TanStack Router hooks that RoutesPage uses
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual("@tanstack/react-router");
  return {
    ...actual,
    useSearch: vi.fn(() => ({})),
    useNavigate: vi.fn(() => vi.fn()),
  };
});

// Mock RouteCanvas to avoid canvas rendering in tests
vi.mock("../components/routes/RouteCanvas", () => ({
  __esModule: true,
  default: vi.fn().mockReturnValue(null),
}));

// Mock RouteLegend
vi.mock("../components/routes/RouteLegend", () => ({
  __esModule: true,
  default: vi.fn().mockReturnValue(null),
}));

import { useAuth } from "../hooks/useAuth";
import { useRouteData } from "../hooks/useRouteData";

const mockUseAuth = vi.mocked(useAuth);
const mockUseRouteData = vi.mocked(useRouteData);

describe("RoutesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRouteData.mockReturnValue({
      routes: [],
      isLoading: false,
      error: null,
    });
  });

  it("shows sign-in prompt when unauthenticated", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByText(/to view your route art/)).toBeInTheDocument();
  });

  it("shows loading state while fetching routes", async () => {
    mockUseAuth.mockReturnValue({
      user: { uid: "u1", email: "a@b.com", displayName: "Test", photoURL: null },
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseRouteData.mockReturnValue({
      routes: [],
      isLoading: true,
      error: null,
    });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText("Loading routes...")).toBeInTheDocument();
  });

  it("shows error message when fetch fails", async () => {
    mockUseAuth.mockReturnValue({
      user: { uid: "u1", email: "a@b.com", displayName: "Test", photoURL: null },
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    mockUseRouteData.mockReturnValue({
      routes: [],
      isLoading: false,
      error: new Error("Network failure"),
    });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText(/Failed to load routes/)).toBeInTheDocument();
  });

  it("shows empty state when no routes exist", async () => {
    mockUseAuth.mockReturnValue({
      user: { uid: "u1", email: "a@b.com", displayName: "Test", photoURL: null },
      loading: false,
      error: null,
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    await renderWithRouter(<RoutesPage />);

    expect(screen.getByText(/No routes yet/)).toBeInTheDocument();
  });
});
