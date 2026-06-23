import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MapTimeRangeFilter, { type MapTimeRangeFilterProps } from "./MapTimeRangeFilter";

function renderFilter(over: Partial<MapTimeRangeFilterProps> = {}) {
  const onChange = vi.fn();
  const props: MapTimeRangeFilterProps = {
    dateDomain: ["2025-01-01", "2026-06-22"],
    dateRange: ["2026-01-01", "2026-06-22"],
    onChange,
    ...over,
  };
  render(<MapTimeRangeFilter {...props} />);
  return { onChange };
}

describe("MapTimeRangeFilter", () => {
  it("renders start/end date inputs reflecting the current range + domain bounds", () => {
    renderFilter();
    const start = screen.getByLabelText("Start date");
    const end = screen.getByLabelText("End date");
    expect(start).toHaveValue("2026-01-01");
    expect(end).toHaveValue("2026-06-22");
    expect(start).toHaveAttribute("min", "2025-01-01");
    expect(end).toHaveAttribute("max", "2026-06-22");
  });

  it("updates the start bound via the date input", () => {
    const { onChange } = renderFilter();
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2025-06-15" } });
    expect(onChange).toHaveBeenLastCalledWith(["2025-06-15", "2026-06-22"]);
  });

  it("clamps start past end so start ≤ end", () => {
    const { onChange } = renderFilter({ dateRange: ["2026-01-01", "2026-03-01"] });
    // Later than the end (2026-03-01) → end follows to keep start ≤ end.
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-05-01" } });
    expect(onChange).toHaveBeenLastCalledWith(["2026-05-01", "2026-05-01"]);
  });

  it("exposes a two-thumb range slider", () => {
    renderFilter();
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });
});
