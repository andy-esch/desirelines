import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressSummary from "./ProgressSummary";

describe("ProgressSummary", () => {
  it("shows the current and projected totals", () => {
    render(<ProgressSummary currentValue={1234.4} estimatedYearEnd={2500} unit="miles" />);

    expect(screen.getByText("1,234 miles")).toBeInTheDocument();
    expect(screen.getByText("2,500 miles")).toBeInTheDocument();
  });

  it("marks a total there's no data for yet as missing", () => {
    render(<ProgressSummary currentValue={0} estimatedYearEnd={0} unit="miles" />);

    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.queryByText("--")).not.toBeInTheDocument();
  });

  it("keeps the loading placeholder while loading", () => {
    render(<ProgressSummary currentValue={0} estimatedYearEnd={0} unit="miles" isLoading />);

    expect(screen.getAllByText("--")).toHaveLength(2);
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});
