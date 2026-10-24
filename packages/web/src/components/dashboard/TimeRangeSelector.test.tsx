import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TimeRangeSelector from "./TimeRangeSelector";
import type { DashboardTimeRange } from "../../utils/timeRange";

describe("TimeRangeSelector", () => {
  it("renders all time range options", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="2w" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "2 Weeks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "4 Weeks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2 Months" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6 Months" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Year to Date" })).toBeInTheDocument();
  });

  it("offers the shared presets in order, without All", () => {
    render(<TimeRangeSelector value="2w" onChange={vi.fn()} />);

    // The dashboard always shows a bounded window, so it leaves out "All".
    // The buttons show the short form and are named by the full label.
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "2W",
      "4W",
      "2M",
      "6M",
      "YTD",
    ]);
  });

  it("highlights the selected option", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="4w" onChange={onChange} />);

    const selectedBtn = screen.getByRole("button", { name: "4 Weeks" });
    const unselectedBtn = screen.getByRole("button", { name: "2 Weeks" });

    expect(selectedBtn).toHaveAttribute("aria-pressed", "true");
    expect(unselectedBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange with correct value when option clicked", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="2w" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "6 Months" }));

    expect(onChange).toHaveBeenCalledWith("6m");
  });

  it("calls onChange for each option", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="ytd" onChange={onChange} />);

    const options: [string, DashboardTimeRange][] = [
      ["2 Weeks", "2w"],
      ["4 Weeks", "4w"],
      ["2 Months", "2m"],
      ["6 Months", "6m"],
      ["Year to Date", "ytd"],
    ];

    options.forEach(([label, expectedValue]) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(onChange).toHaveBeenCalledWith(expectedValue);
    });
  });

  it("keeps the current range when the selected one is clicked again", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="4w" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "4 Weeks" }));

    expect(onChange).toHaveBeenCalledWith("4w");
  });

  it("has accessible group role", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="2w" onChange={onChange} />);

    expect(screen.getByRole("group", { name: /time range selector/i })).toBeInTheDocument();
  });
});
