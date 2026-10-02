import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import RouteChartTooltip from "./RouteChartTooltip";

const formats = {
  name: "Volume",
  formatLabel: (label: unknown) => `Week of ${String(label)}`,
  formatValue: (value: number) => `${Math.round(value)} mi`,
};

describe("RouteChartTooltip", () => {
  it("titles the hovered week and shows its value in the shared frame", () => {
    render(<RouteChartTooltip active label="Sep 1" payload={[{ value: 41.6 }]} {...formats} />);
    expect(screen.getByText("Week of Sep 1")).toBeInTheDocument();
    expect(screen.getByText("Volume")).toBeInTheDocument();
    expect(screen.getByText("42 mi")).toBeInTheDocument();
    expect(screen.getByText("42 mi").closest("div[style*='--tooltip-shadow']")).not.toBeNull();
  });

  it("draws nothing until a point is hovered", () => {
    const { container } = render(
      <RouteChartTooltip active={false} label="Sep 1" payload={[{ value: 41.6 }]} {...formats} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("draws nothing for a point without a value", () => {
    const { container } = render(
      <RouteChartTooltip active label="Sep 1" payload={[]} {...formats} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
