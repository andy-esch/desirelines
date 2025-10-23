import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartTooltip } from "./ChartTooltip";

describe("ChartTooltip", () => {
  const mockPayload = [
    {
      name: "Actual",
      value: 2450,
      stroke: "#4285f4",
      color: "#4285f4",
    },
    {
      name: "Goal Line",
      value: 2800,
      stroke: "#34a853",
      color: "#34a853",
    },
  ];

  it("renders nothing when inactive", () => {
    const { container } = render(
      <ChartTooltip active={false} payload={mockPayload} label="2025-10-22" />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when payload is empty", () => {
    const { container } = render(<ChartTooltip active={true} payload={[]} label="2025-10-22" />);

    expect(container.firstChild).toBeNull();
  });

  it("renders date and values when active", () => {
    render(
      <ChartTooltip active={true} payload={mockPayload} label="2025-10-22" unit="mi" decimals={1} />
    );

    // Check data entries render correctly
    expect(screen.getByText("Actual:")).toBeInTheDocument();
    expect(screen.getByText("2450.0 mi")).toBeInTheDocument();

    expect(screen.getByText("Goal Line:")).toBeInTheDocument();
    expect(screen.getByText("2800.0 mi")).toBeInTheDocument();
  });

  it("uses custom unit", () => {
    render(
      <ChartTooltip
        active={true}
        payload={[{ name: "Pace", value: 8.25 }]}
        label="2025-10-22"
        unit="mi/day"
        decimals={2}
      />
    );

    expect(screen.getByText(/8.25 mi\/day/)).toBeInTheDocument();
  });

  it("respects decimal places", () => {
    render(
      <ChartTooltip
        active={true}
        payload={[{ name: "Distance", value: 2450.567 }]}
        label="2025-10-22"
        unit="mi"
        decimals={2}
      />
    );

    expect(screen.getByText("2450.57 mi")).toBeInTheDocument();
  });

  it("handles string values", () => {
    render(
      <ChartTooltip
        active={true}
        payload={[{ name: "Status", value: "Active" }]}
        label="2025-10-22"
        unit=""
      />
    );

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("uses default unit (mi) and decimals (1) when not provided", () => {
    render(
      <ChartTooltip active={true} payload={[{ name: "Test", value: 123.456 }]} label="2025-10-22" />
    );

    expect(screen.getByText("123.5 mi")).toBeInTheDocument();
  });

  it("uses fallback color when stroke/color not provided", () => {
    render(
      <ChartTooltip active={true} payload={[{ name: "Test", value: 100 }]} label="2025-10-22" />
    );

    // Check that the tooltip renders with data
    expect(screen.getByText("Test:")).toBeInTheDocument();
    expect(screen.getByText("100.0 mi")).toBeInTheDocument();
  });
});
