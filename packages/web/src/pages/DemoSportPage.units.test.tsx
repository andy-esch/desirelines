import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import DemoSportPage from "./DemoSportPage";
import { renderWithRouter } from "../test/renderWithRouter";
import { DemoStore } from "../test/fixtures/demoStore";
import { mockSportConfig } from "../test/fixtures/sportConfig";
import { saveDemoSection } from "../services/demoStorage";
import { GOAL_STORAGE_VERSION } from "../services/userConfigService";
import { DEFAULT_PREFERENCES } from "../constants/settings";

// The page's own unit handling runs for real here; DemoSportPage.test.tsx stubs it out.

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual("@tanstack/react-router");
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("../hooks/useCurrentYear", () => ({ useCurrentYear: () => 2026 }));

vi.mock("../hooks/useDemoData", () => ({
  useDemoData: () => ({
    metrics: null,
    sportConfig: mockSportConfig,
    isLoading: false,
    error: null,
  }),
  // The demo's starting goals are written in miles.
  getDemoGoalsForSport: () => ({ conservative: 2000, target: 2500, stretch: 3000 }),
}));

vi.mock("../hooks/useSidebarSportData", () => ({
  useDemoSidebarSportData: () => ({ availableSports: ["running"], sportCounts: { running: 1 } }),
}));

vi.mock("../components/SportPageContent", () => ({
  default: (props: { goals: { value: number }[]; unit: string }) => (
    <div>
      <span data-testid="goal-values">{props.goals.map((g) => g.value).join(",")}</span>
      <span data-testid="unit">{props.unit}</span>
    </div>
  ),
}));

vi.mock("../components/MomentumIndicator", () => ({ default: () => null }));

const inKilometers = () =>
  saveDemoSection("preferences", { ...DEFAULT_PREFERENCES, distanceUnit: "kilometers" });

describe("DemoSportPage units", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the starting goals in the demo's chosen unit", async () => {
    inKilometers();
    await renderWithRouter(<DemoSportPage sport="running" year="2026" />, { wrapper: DemoStore });

    expect(await screen.findByText("kilometers")).toBeInTheDocument();
    // 2,000 / 2,500 / 3,000 mi.
    expect(screen.getByTestId("goal-values")).toHaveTextContent("3219,4023,4828");
  });

  it("shows saved goals in the demo's chosen unit", async () => {
    inKilometers();
    saveDemoSection(
      "goals",
      {
        goals: [{ id: "a", value: 5_000_000, label: "A", metric: "distance_meters" }],
        storageVersion: GOAL_STORAGE_VERSION,
      },
      2026,
      "running"
    );
    await renderWithRouter(<DemoSportPage sport="running" year="2026" />, { wrapper: DemoStore });

    expect(await screen.findByText("5000")).toBeInTheDocument();
  });

  it("reads goals saved before canonical units as the miles they were saved in", async () => {
    inKilometers();
    saveDemoSection(
      "goals",
      { goals: [{ id: "a", value: 3000, label: "A", metric: "distance_meters" }] },
      2026,
      "running"
    );
    await renderWithRouter(<DemoSportPage sport="running" year="2026" />, { wrapper: DemoStore });

    expect(await screen.findByText("4828")).toBeInTheDocument();
  });

  it("stays in miles when the demo hasn't chosen a unit", async () => {
    await renderWithRouter(<DemoSportPage sport="running" year="2026" />, { wrapper: DemoStore });

    expect(await screen.findByText("miles")).toBeInTheDocument();
    expect(screen.getByTestId("goal-values")).toHaveTextContent("2000,2500,3000");
  });
});
