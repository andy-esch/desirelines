import { describe, it, expect } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import Loader from "./Loader";
import { getTheme } from "../themes/registry";
import { ThemeStructureProvider } from "./theme/ThemeStructureProvider";

function withLoaderStyle(loaderStyle: "chaser" | "block", node: ReactNode) {
  return render(
    <ThemeStructureProvider structure={{ ...getTheme("miami").structure, loaderStyle }}>
      {node}
    </ThemeStructureProvider>
  );
}

describe("Loader", () => {
  it('shows and announces "Loading…" unless told what loads', () => {
    render(<Loader />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Loading…$/);
  });

  it("names what loads when given a label", () => {
    render(<Loader label="Loading map…" />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Loading map…$/);
  });

  it("lights its segments in the meter's done color, hidden from screen readers", () => {
    const { container } = render(<Loader />);
    const segments = container.querySelector(".loader-segment")?.parentElement;
    expect(segments).toHaveClass("text-(--color-meter-done)");
    expect(segments).toHaveAttribute("aria-hidden", "true");
  });

  it("puts the block style's cursor after the label", () => {
    const { container } = withLoaderStyle("block", <Loader />);
    const cursor = container.querySelector(".loader-cursor");
    expect(screen.getByText("Loading…")).toContainElement(cursor as HTMLElement);
  });

  it("draws no cursor for the chaser", () => {
    const { container } = withLoaderStyle("chaser", <Loader />);
    expect(container.querySelector(".loader-cursor")).not.toBeInTheDocument();
  });
});
