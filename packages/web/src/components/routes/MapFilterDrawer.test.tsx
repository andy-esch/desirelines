import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapFilterDrawer, { type MapFilterDrawerProps } from "./MapFilterDrawer";
import type { ActivityTotals } from "../../utils/routeFilters";

const TOTALS: ActivityTotals = {
  count: 142,
  distanceMeters: 1_995_000,
  movingTimeSeconds: 360_000,
  elevationMeters: 12_000,
};

function renderDrawer(over: Partial<MapFilterDrawerProps> = {}) {
  const onOpenChange = vi.fn();
  const onReset = vi.fn();
  const props: MapFilterDrawerProps = {
    open: true,
    onOpenChange,
    totals: TOTALS,
    totalCount: 300,
    activeFilterCount: 0,
    onReset,
    distanceUnit: "miles",
    elevationUnit: "feet",
    ...over,
  };
  render(<MapFilterDrawer {...props} />);
  return { onOpenChange, onReset };
}

describe("MapFilterDrawer", () => {
  it("renders the filtered count and a unit-aware distance in the summary", () => {
    renderDrawer();
    expect(screen.getByText("142")).toBeInTheDocument();
    // 1,995,000 m ≈ 1,240 mi — appears in both the visual grid and the sr-only mirror.
    expect(screen.getAllByText(/1,240 mi/).length).toBeGreaterThan(0);
  });

  it("announces the filtered totals to screen readers via a polite live region", () => {
    renderDrawer({ activeFilterCount: 2 });
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/142 activities filtered/);
    expect(status).toHaveTextContent(/1,240 mi/);
  });

  it("shows the collapse control and fires onOpenChange(false) when collapsed", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDrawer();
    await user.click(screen.getByRole("button", { name: /collapse panel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("fires onOpenChange(true) when the closed-state handle is clicked", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDrawer({ open: false });
    await user.click(screen.getByRole("button", { name: /explore/i }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("hides the reset control until a filter is active", () => {
    renderDrawer({ activeFilterCount: 0 });
    expect(screen.queryByRole("button", { name: /reset filters/i })).not.toBeInTheDocument();
  });

  it("resets when the reset control is clicked", async () => {
    const user = userEvent.setup();
    const { onReset } = renderDrawer({ activeFilterCount: 2 });
    await user.click(screen.getByRole("button", { name: /reset filters/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("surfaces a filter-count badge when filters are active", () => {
    renderDrawer({ activeFilterCount: 3 });
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("shows a quiet placeholder while loading instead of zeros", () => {
    renderDrawer({ isLoading: true });
    expect(screen.getByText(/loading your routes/i)).toBeInTheDocument();
    expect(screen.queryByText("142")).not.toBeInTheDocument();
  });

  it("surfaces an error state", () => {
    renderDrawer({ error: new Error("boom") });
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/i);
  });

  it("reflects open state via aria on the toggle and region", () => {
    renderDrawer({ open: false });
    expect(screen.getByRole("button", { name: /explore/i })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});
