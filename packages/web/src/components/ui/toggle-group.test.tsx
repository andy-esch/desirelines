import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

function YearGroup({ onValueChange }: { onValueChange?: (v: unknown) => void }) {
  return (
    <ToggleGroup defaultValue={["2026"]} onValueChange={onValueChange} aria-label="Year">
      <ToggleGroupItem value="2025">2025</ToggleGroupItem>
      <ToggleGroupItem value="2026">2026</ToggleGroupItem>
    </ToggleGroup>
  );
}

describe("ToggleGroup", () => {
  it("reflects the pressed item via aria-pressed", () => {
    render(<YearGroup />);
    expect(screen.getByRole("button", { name: "2026" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2025" })).toHaveAttribute("aria-pressed", "false");
  });

  it("fires onValueChange when a different item is pressed", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(<YearGroup onValueChange={onValueChange} />);

    await user.click(screen.getByRole("button", { name: "2025" }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0]![0]).toContain("2025");
  });
});
