import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ChartContainer } from "./ChartContainer";
import { getTheme } from "../../themes/registry";
import { ThemeStructureProvider } from "../theme/ThemeStructureProvider";

/** Miami labels a panel from above; Arcade puts the label in a bar inside the frame. */
const PLACEMENTS = [getTheme("miami").structure, getTheme("arcade").structure];

function inStructure(structure: (typeof PLACEMENTS)[number], node: ReactNode) {
  return render(<ThemeStructureProvider structure={structure}>{node}</ThemeStructureProvider>);
}

const base = { title: "Cumulative Distance", isLoading: false, error: null, isEmpty: false };

describe.each(PLACEMENTS)("ChartContainer with $sectionLabelPlacement labels", (structure) => {
  it("frames the chart in a panel with the title and controls in its header", () => {
    const { container } = inStructure(
      structure,
      <ChartContainer {...base} headerControls={<button>YTD</button>}>
        <p>chart</p>
      </ChartContainer>
    );
    const panel = container.querySelector("section");
    expect(panel).toContainElement(screen.getByRole("heading", { name: "Cumulative Distance" }));
    expect(panel).toContainElement(screen.getByRole("button", { name: "YTD" }));
    expect(screen.getByText("chart")).not.toContainElement(screen.getByRole("button"));
  });

  it("keeps the title but not the controls while loading", () => {
    inStructure(
      structure,
      <ChartContainer {...base} isLoading headerControls={<button>YTD</button>}>
        <p>chart</p>
      </ChartContainer>
    );
    expect(screen.getByRole("heading", { name: "Cumulative Distance" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "YTD" })).not.toBeInTheDocument();
    expect(screen.queryByText("chart")).not.toBeInTheDocument();
  });

  it("titles an error one level under the chart's heading", () => {
    inStructure(
      structure,
      <ChartContainer {...base} error={new Error("timeout")}>
        <p>chart</p>
      </ChartContainer>
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Cumulative Distance" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Error loading chart data" })
    ).toBeInTheDocument();
  });
});
