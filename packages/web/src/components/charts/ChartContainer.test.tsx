import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChartContainer } from "./ChartContainer";
import { getTheme } from "../../themes/registry";
import { ThemeStructureProvider } from "../theme/ThemeStructureProvider";

/** Legacy's structure puts a panel's title in a card header, as these cases expect. */
function inLegacy(node: ReactNode) {
  return render(
    <ThemeStructureProvider structure={getTheme("legacy-dark").structure}>
      {node}
    </ThemeStructureProvider>
  );
}

const base = { title: "Cumulative Distance", isLoading: false, error: null, isEmpty: false };

describe("ChartContainer", () => {
  it("frames the chart in a panel with the title and controls in its header", () => {
    const { container } = inLegacy(
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
    inLegacy(
      <ChartContainer {...base} isLoading framed headerControls={<button>YTD</button>}>
        <p>chart</p>
      </ChartContainer>
    );
    expect(screen.getByRole("heading", { name: "Cumulative Distance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "YTD" })).not.toBeInTheDocument();
    expect(screen.queryByText("chart")).not.toBeInTheDocument();
  });

  it("draws its own header row when not framed", () => {
    const { container } = inLegacy(
      <ChartContainer {...base} headerControls={<button>YTD</button>}>
        <p>chart</p>
      </ChartContainer>
    );
    expect(container.querySelector("section")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cumulative Distance" })).toBeInTheDocument();
  });
});
