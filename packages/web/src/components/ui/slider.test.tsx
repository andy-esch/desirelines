import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Slider } from "./slider";

describe("Slider", () => {
  it("renders a single thumb for a scalar value", () => {
    render(<Slider value={50} min={0} max={100} aria-label="Distance" />);
    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("renders two thumbs for a range value (the distance/time filters)", () => {
    render(<Slider value={[20, 80]} min={0} max={100} />);
    expect(screen.getAllByRole("slider")).toHaveLength(2);
  });

  it("derives thumb count from defaultValue when uncontrolled", () => {
    render(<Slider defaultValue={[10, 40, 70]} min={0} max={100} />);
    expect(screen.getAllByRole("slider")).toHaveLength(3);
  });
});
