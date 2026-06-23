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

const ZERO_TOTALS: ActivityTotals = {
  count: 0,
  distanceMeters: 0,
  movingTimeSeconds: 0,
  elevationMeters: 0,
};

function renderDrawer(over: Partial<MapFilterDrawerProps> = {}) {
  const onOpenChange = vi.fn();
  const onReset = vi.fn();
  const onShowAll = vi.fn();
  const props: MapFilterDrawerProps = {
    open: true,
    onOpenChange,
    totals: TOTALS,
    totalCount: 300,
    activeFilterCount: 0,
    onReset,
    onShowAll,
    distanceUnit: "miles",
    elevationUnit: "feet",
    isDark: true,
    ...over,
  };
  render(<MapFilterDrawer {...props} />);
  return { onOpenChange, onReset, onShowAll };
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
    await user.click(screen.getByRole("button", { name: /filters/i }));
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

  it("surfaces a load error kindly (status, not a severe alert) with no zero stats", () => {
    renderDrawer({ error: new Error("boom") });
    // Announced as a polite status, not an assertive red alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/couldn't load your activities/i);
    // No alarming "0" stat dump.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows a gentle empty-dataset message when the user has no routes at all", () => {
    renderDrawer({ totals: ZERO_TOTALS, totalCount: 0 });
    expect(screen.getByRole("status")).toHaveTextContent(/no routes recorded yet/i);
    expect(screen.queryByRole("button", { name: /show all activities/i })).not.toBeInTheDocument();
  });

  it("offers a 'Show all activities' recourse when filters exclude everything", async () => {
    const user = userEvent.setup();
    // Routes exist (totalCount 300) but the current filters match none.
    const { onShowAll } = renderDrawer({ totals: ZERO_TOTALS, totalCount: 300 });
    expect(screen.getByRole("status")).toHaveTextContent(/no activities match these filters/i);
    await user.click(screen.getByRole("button", { name: /show all activities/i }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("reflects open state via aria on the toggle", () => {
    renderDrawer({ open: false });
    expect(screen.getByRole("button", { name: /filters/i })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});
