import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MissingValue } from "./MissingValue";

describe("MissingValue", () => {
  it("shows an em dash in the theme's missing-value color, and says none to a screen reader", () => {
    render(<MissingValue />);
    const dash = screen.getByText("—");
    expect(dash).toHaveAttribute("aria-hidden", "true");
    expect(dash.parentElement?.className).toContain("--missing-value-color");
    expect(screen.getByText("none")).toHaveClass("sr-only");
  });
});
