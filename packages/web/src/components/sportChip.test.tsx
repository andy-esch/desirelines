import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { sportChipClass } from "./sportChip";

describe("sportChipClass", () => {
  it("keeps the sport chip's own pressed look over the toggle item's", () => {
    // A chip is a toggle item, so its classes merge with the item's; the chip's fill, ink
    // and border win, and the theme's pressed-toggle glows drop out rather than haloing
    // the sport fill.
    render(
      <ToggleGroup defaultValue={["ride"]} aria-label="Sports">
        <ToggleGroupItem value="ride" className={sportChipClass}>
          Ride
        </ToggleGroupItem>
      </ToggleGroup>
    );
    const classes = screen.getByRole("button", { name: "Ride" }).className.split(/\s+/);

    expect(classes).toEqual(
      expect.arrayContaining([
        "data-[pressed]:bg-[var(--chip)]",
        "data-[pressed]:text-on-accent",
        "data-[pressed]:border-chart-mark-outline",
        "data-[pressed]:inset-shadow-none",
        "data-[pressed]:[text-shadow:none]",
      ])
    );
    expect(classes.filter((c) => c.includes("toggle-pressed"))).toEqual([]);
  });
});
