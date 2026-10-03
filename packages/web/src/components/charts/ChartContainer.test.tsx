import { describe, it, expect, onTestFinished, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import ChartContainer from "./ChartContainer";
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

  it("frames a failed load in the danger tone, with Retry", async () => {
    const onRetry = vi.fn();
    const { container } = inStructure(
      structure,
      <ChartContainer {...base} error={new Error("timeout")} onRetry={onRetry}>
        <p>chart</p>
      </ChartContainer>
    );
    expect(container.querySelector("section")?.outerHTML).toContain("--error-frame-color");
    expect(screen.getByRole("alert")).toHaveTextContent("timeout");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("catches a chart that throws while drawing, and Retry fetches and draws again", async () => {
    const onRetry = vi.fn();
    let crash = true;
    function Chart() {
      if (crash) throw new Error("bad point");
      return <p>chart</p>;
    }
    // React reports the caught error; keep it out of the test output.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    inStructure(
      structure,
      <ChartContainer {...base} onRetry={onRetry}>
        <Chart />
      </ChartContainer>
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Error displaying the chart.*bad point/);

    crash = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText("chart")).toBeInTheDocument();
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
