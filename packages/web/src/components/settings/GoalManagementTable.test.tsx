import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GoalManagementTable } from "./GoalManagementTable";
import { TestServiceProvider } from "../../contexts/ServiceContext";
import { AuthProvider } from "../../contexts/AuthContext";
import { ToastProvider } from "../../contexts/ToastContext";
import { UserConfigProvider } from "../../contexts/UserConfigProvider";
import { DemoStore } from "../../test/fixtures/demoStore";
import { ACCOUNT_CONFIG_PATH, accountServices, storedGoal } from "../../test/fixtures/userConfig";
import { saveDemoSection } from "../../services/demoStorage";
import { GOAL_STORAGE_VERSION } from "../../services/userConfigService";
import { DEFAULT_PREFERENCES } from "../../constants/settings";
import { mockSportConfig } from "../../test/fixtures/sportConfig";

vi.mock("../../hooks/useCurrentYear", () => ({ useCurrentYear: () => 2026 }));
vi.mock("../../hooks/useSportConfig", () => ({
  useSportConfig: () => ({
    sportConfig: mockSportConfig,
    isLoading: false,
    error: null,
    retry: () => undefined,
  }),
}));

/** The account's store, over `services`. */
function accountStore(services: ReturnType<typeof accountServices>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TestServiceProvider {...services}>
          <AuthProvider>
            <UserConfigProvider>{children}</UserConfigProvider>
          </AuthProvider>
        </TestServiceProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const saveDemoGoal = () =>
  saveDemoSection(
    "goals",
    { goals: [storedGoal("Demo target", 1000)], storageVersion: GOAL_STORAGE_VERSION },
    2026,
    "cycling"
  );

describe("GoalManagementTable", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("lists the demo's own goals signed out", async () => {
    saveDemoGoal();
    render(<GoalManagementTable />, { wrapper: DemoStore });

    expect(await screen.findByText("Demo target")).toBeInTheDocument();
  });

  it("lists the account's goals signed in, and none of the demo's", async () => {
    saveDemoGoal();
    const services = accountServices(2026, { running: [storedGoal("Account target", 5000)] });
    render(<GoalManagementTable />, { wrapper: accountStore(services) });

    expect(await screen.findByText("Account target")).toBeInTheDocument();
    expect(screen.queryByText("Demo target")).toBeNull();
  });

  it("keeps showing the goals it has after the listener fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const services = accountServices(2026, { running: [storedGoal("Account target", 5000)] });
    render(<GoalManagementTable />, { wrapper: accountStore(services) });
    await screen.findByText("Account target");

    act(() => services.databaseService.failListeners(ACCOUNT_CONFIG_PATH, new Error("offline")));

    // The store says the sync failed; the table keeps the last good copy.
    expect(await screen.findByText(/couldn't be synced/)).toBeInTheDocument();
    expect(screen.getByText("Account target")).toBeInTheDocument();
    expect(screen.queryByText("Error loading goals")).toBeNull();
  });

  it("shows an account's goals in the session's units, with the unit", async () => {
    // 4,828,032 m is 3,000 mi.
    const services = accountServices(2026, { running: [storedGoal("Account target", 4_828_032)] });
    render(<GoalManagementTable />, { wrapper: accountStore(services) });

    await screen.findByText("Account target");
    expect(screen.getByText("3,000 mi")).toBeInTheDocument();
  });

  it("shows distance in the chosen unit and time in hours", async () => {
    saveDemoSection("preferences", { ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" });
    saveDemoSection(
      "goals",
      { goals: [storedGoal("Ride", 5_000_000)], storageVersion: GOAL_STORAGE_VERSION },
      2026,
      "cycling"
    );
    saveDemoSection(
      "goals",
      { goals: [storedGoal("Stretch", 15_000)], storageVersion: GOAL_STORAGE_VERSION },
      2026,
      "yoga"
    );
    render(<GoalManagementTable />, { wrapper: DemoStore });

    await screen.findByText("Ride");
    expect(screen.getByText("5,000 km")).toBeInTheDocument();
    expect(screen.getByText("250 hrs")).toBeInTheDocument();
  });

  it("reads a goal saved before canonical units as the miles it was saved in", async () => {
    saveDemoSection("preferences", { ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" });
    saveDemoSection("goals", { goals: [storedGoal("Old target", 3000)] }, 2026, "cycling");
    render(<GoalManagementTable />, { wrapper: DemoStore });

    await screen.findByText("Old target");
    expect(screen.getByText("4,828 km")).toBeInTheDocument();
  });

  it("says the goals failed to load when none ever did", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const services = accountServices(2026, {});
    vi.spyOn(services.databaseService, "subscribeToDocument").mockImplementation(
      (_path, _onData, onError) => {
        onError?.(new Error("permission-denied"));
        return () => {};
      }
    );
    render(<GoalManagementTable />, { wrapper: accountStore(services) });

    expect(await screen.findByText("Error loading goals")).toBeInTheDocument();
  });
});
