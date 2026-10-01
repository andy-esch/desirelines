/**
 * Tests for LoadingChart component
 *
 * Simple presentation component that shows the theme's loader.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoadingChart from "./LoadingChart";

describe("LoadingChart", () => {
  it("renders loading spinner with accessible role", () => {
    render(<LoadingChart />);

    const spinner = screen.getByRole("status");
    expect(spinner).toBeInTheDocument();
  });

  it('labels the loader "Loading…", shown and announced', () => {
    render(<LoadingChart />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.getByText("Loading…")).not.toHaveClass("sr-only");
  });

  it("applies Tailwind styling classes", () => {
    const { container } = render(<LoadingChart />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("flex");
    expect(wrapper).toHaveClass("justify-center");
    expect(wrapper).toHaveClass("items-center");
  });

  it("has minimum height for visual consistency", () => {
    const { container } = render(<LoadingChart />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle({ minHeight: "300px" });
  });
});
