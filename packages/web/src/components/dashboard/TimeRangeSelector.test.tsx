import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TimeRangeSelector from "./TimeRangeSelector";
import type { TimeRange } from "../../utils/dataNormalization";

describe("TimeRangeSelector", () => {
  it("renders all time range options", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="2weeks" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "2W" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "4W" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2M" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "6M" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "YTD" })).toBeInTheDocument();
  });

  it("highlights the selected option", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="4weeks" onChange={onChange} />);

    const selectedBtn = screen.getByRole("button", { name: "4W" });
    const unselectedBtn = screen.getByRole("button", { name: "2W" });

    expect(selectedBtn).toHaveClass("btn-secondary");
    expect(unselectedBtn).toHaveClass("btn-outline-secondary");
  });

  it("calls onChange with correct value when option clicked", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="2weeks" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "6M" }));

    expect(onChange).toHaveBeenCalledWith("6months");
  });

  it("calls onChange for each option", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="ytd" onChange={onChange} />);

    const options: [string, TimeRange][] = [
      ["2W", "2weeks"],
      ["4W", "4weeks"],
      ["2M", "2months"],
      ["6M", "6months"],
      ["YTD", "ytd"],
    ];

    options.forEach(([label, expectedValue]) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(onChange).toHaveBeenCalledWith(expectedValue);
    });
  });

  it("has accessible group role", () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector value="2weeks" onChange={onChange} />);

    expect(screen.getByRole("group", { name: /time range selector/i })).toBeInTheDocument();
  });
});
