import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapFilterControls, { type MapFilterControlsProps } from "./MapFilterControls";
import { defaultRouteFilters } from "../../utils/routeFilters";

// SportVisibilityHint uses TanStack Router's <Link>; stub it as an <a> (with a real
// href so it keeps the "link" role) — no router context in this unit test.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, hash, children }: { to?: string; hash?: string; children: ReactNode }) => (
    <a href={hash ? `${to}#${hash}` : to}>{children}</a>
  ),
}));

const NOW = new Date("2026-06-22T12:00:00");

function renderControls(over: Partial<MapFilterControlsProps> = {}) {
  const handlers = {
    onSportsChange: vi.fn(),
    onDistanceChange: vi.fn(),
    onSelectYear: vi.fn(),
    onSelectAllTime: vi.fn(),
    onSelectRegion: vi.fn(),
  };
  const props: MapFilterControlsProps = {
    filters: defaultRouteFilters(NOW),
    sportOptions: [
      { value: "cycling", label: "Cycling", color: "rgb(0,255,255)" },
      { value: "running", label: "Running", color: "rgb(0,200,255)" },
    ],
    mySports: [],
    distanceDomain: [0, 80_000],
    dateDomain: ["2025-08-01", "2026-06-22"],
    distanceUnit: "miles",
    now: NOW,
    regions: [
      {
        regionId: 10,
        name: "New York",
        kind: "metro",
        activityCount: 42,
        bbox: [-74, 40, -73, 41],
      },
      { regionId: 20, name: "Boston", kind: "metro", activityCount: 9, bbox: [-71, 42, -70, 43] },
    ],
    selectedRegionId: null,
    ...handlers,
    ...over,
  };
  render(<MapFilterControls {...props} />);
  return handlers;
}

describe("MapFilterControls", () => {
  it("renders a sport chip per option and toggles on click", async () => {
    const user = userEvent.setup();
    const { onSportsChange } = renderControls();
    expect(screen.getByRole("button", { name: "Cycling" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Running" }));
    expect(onSportsChange).toHaveBeenCalledWith(["running"]);
  });

  it("hides the sport Clear control when no sports are selected", () => {
    renderControls();
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
  });

  it("clears the sport selection via the Clear control", async () => {
    const user = userEvent.setup();
    const { onSportsChange } = renderControls({
      filters: { ...defaultRouteFilters(NOW), sports: ["cycling"] },
    });
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(onSportsChange).toHaveBeenCalledWith([]);
  });

  it("applies the configured visible sports via the 'My sports' preset", async () => {
    const user = userEvent.setup();
    const { onSportsChange } = renderControls({ mySports: ["cycling"] });
    await user.click(screen.getByRole("button", { name: /my sports/i }));
    expect(onSportsChange).toHaveBeenCalledWith(["cycling"]);
  });

  it("marks 'My sports' pressed when the filter already equals the preference", () => {
    renderControls({
      mySports: ["cycling"],
      filters: { ...defaultRouteFilters(NOW), sports: ["cycling"] },
    });
    expect(screen.getByRole("button", { name: /my sports/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("toggles 'My sports' off (clears to all sports) when it is already active", async () => {
    const user = userEvent.setup();
    const { onSportsChange } = renderControls({
      mySports: ["cycling"],
      filters: { ...defaultRouteFilters(NOW), sports: ["cycling"] },
    });
    await user.click(screen.getByRole("button", { name: /my sports/i }));
    expect(onSportsChange).toHaveBeenCalledWith([]);
  });

  it("narrows the 'My sports' preset to sports present in the dataset", async () => {
    const user = userEvent.setup();
    // "swimming" isn't among the sportOptions (dataset) → excluded from the preset.
    const { onSportsChange } = renderControls({ mySports: ["cycling", "swimming"] });
    await user.click(screen.getByRole("button", { name: /my sports/i }));
    expect(onSportsChange).toHaveBeenCalledWith(["cycling"]);
  });

  it("hides 'My sports' when no preferred sport is present in the dataset", () => {
    renderControls({ mySports: ["swimming"] });
    expect(screen.queryByRole("button", { name: /my sports/i })).not.toBeInTheDocument();
  });

  it("hides 'My sports' when the preference isn't a proper subset of present sports", () => {
    // Empty preference → no preset.
    renderControls({ mySports: [] });
    expect(screen.queryByRole("button", { name: /my sports/i })).not.toBeInTheDocument();
    // Preference == all present sports → redundant with All/clear, so hidden.
    renderControls({ mySports: ["cycling", "running"] });
    expect(screen.queryByRole("button", { name: /my sports/i })).not.toBeInTheDocument();
  });

  it("links to the shared visible-sports settings", () => {
    renderControls();
    expect(screen.getByRole("link", { name: /manage visible sports/i })).toBeInTheDocument();
  });

  it("marks the current-year chip as pressed by default", () => {
    renderControls();
    expect(screen.getByRole("button", { name: "2026" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  });

  it("quick-selects a past year", async () => {
    const user = userEvent.setup();
    const { onSelectYear } = renderControls();
    await user.click(screen.getByRole("button", { name: "2025" }));
    expect(onSelectYear).toHaveBeenCalledWith(2025);
  });

  it("widens to all time via the All chip", async () => {
    const user = userEvent.setup();
    const { onSelectAllTime } = renderControls();
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(onSelectAllTime).toHaveBeenCalledTimes(1);
  });

  it("marks the All chip pressed when the window spans the full domain", () => {
    renderControls({
      filters: { ...defaultRouteFilters(NOW), dateRange: ["2025-08-01", "2026-06-22"] },
    });
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows unit-aware distance bounds", () => {
    renderControls();
    // 80,000 m ≈ 50 mi
    expect(screen.getByText("50 mi")).toBeInTheDocument();
    expect(screen.getByText("0 mi")).toBeInTheDocument();
  });

  it("gives the distance slider thumbs unit-aware aria value text", () => {
    renderControls();
    // Screen readers hear "0 mi"/"50 mi", not the raw meters (0 / 80,000).
    const thumbs = screen.getAllByRole("slider");
    expect(thumbs[0]).toHaveAttribute("aria-valuetext", "0 mi");
    expect(thumbs[1]).toHaveAttribute("aria-valuetext", "50 mi");
  });

  it("lists regions by name with activity counts and selects one", async () => {
    const user = userEvent.setup();
    const { onSelectRegion } = renderControls();
    // Trigger shows "All regions" by default.
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);
    // The Base UI Select opens its listbox in a portal on a Floating-UI tick, so the
    // options aren't in the DOM synchronously — await them (a sync `getByRole` here
    // races the mount and fails deterministically in isolation / flakily in the suite).
    // Regions are listed densest-first with counts.
    await user.click(await screen.findByRole("option", { name: /New York \(42\)/ }));
    expect(onSelectRegion).toHaveBeenCalledWith(10);
  });

  it("greys out and disables every control when the dataset is empty", () => {
    renderControls({ disabled: true });
    expect(screen.getByRole("button", { name: "Cycling" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2026" })).toBeDisabled();
  });
});
