/**
 * Tests for LoadingChart component
 *
 * Simple presentation component that shows a loading spinner.
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

  it('shows visually hidden "Loading..." text for screen readers', () => {
    render(<LoadingChart />);

    const loadingText = screen.getByText("Loading...");
    expect(loadingText).toBeInTheDocument();
    expect(loadingText).toHaveClass("visually-hidden");
  });

  it("applies Bootstrap styling classes", () => {
    const { container } = render(<LoadingChart />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveClass("d-flex");
    expect(wrapper).toHaveClass("justify-content-center");
    expect(wrapper).toHaveClass("align-items-center");
  });

  it("has minimum height for visual consistency", () => {
    const { container } = render(<LoadingChart />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle({ minHeight: "300px" });
  });
});
