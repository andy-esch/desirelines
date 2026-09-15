import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartContainer } from "./ChartContainer";

const base = { title: "Cumulative Distance", isLoading: false, error: null, isEmpty: false };

describe("ChartContainer", () => {
  it("frames the chart in a panel with the title and controls in its header", () => {
    const { container } = render(
      <ChartContainer {...base} framed headerControls={<button>YTD</button>}>
        <p>chart</p>
      </ChartContainer>
    );
    const panel = container.querySelector("section");
    expect(panel).toContainElement(screen.getByRole("heading", { name: "Cumulative Distance" }));
    expect(panel).toContainElement(screen.getByRole("button", { name: "YTD" }));
    expect(screen.getByText("chart")).not.toContainElement(screen.getByRole("button"));
  });

  it("keeps the title but not the controls while loading", () => {
    render(
      <ChartContainer {...base} isLoading framed headerControls={<button>YTD</button>}>
        <p>chart</p>
      </ChartContainer>
    );
    expect(screen.getByRole("heading", { name: "Cumulative Distance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "YTD" })).not.toBeInTheDocument();
    expect(screen.queryByText("chart")).not.toBeInTheDocument();
  });

  it("draws its own header row when not framed", () => {
    const { container } = render(
      <ChartContainer {...base} headerControls={<button>YTD</button>}>
        <p>chart</p>
      </ChartContainer>
    );
    expect(container.querySelector("section")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cumulative Distance" })).toBeInTheDocument();
  });
});
