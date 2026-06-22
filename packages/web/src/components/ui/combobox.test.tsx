import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Combobox,
  ComboboxChips,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
} from "./combobox";

function MultiSport({ onValueChange }: { onValueChange?: (v: unknown) => void }) {
  return (
    <Combobox multiple defaultValue={[]} onValueChange={onValueChange} items={["Ride", "Run"]}>
      <ComboboxChips>
        <ComboboxInput placeholder="Sports" />
      </ComboboxChips>
      <ComboboxContent>
        <ComboboxList>
          <ComboboxItem value="Ride">Ride</ComboboxItem>
          <ComboboxItem value="Run">Run</ComboboxItem>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

describe("Combobox (multi-select)", () => {
  it("opens on input click and selects an option, firing onValueChange with the array", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(<MultiSport onValueChange={onValueChange} />);

    await user.click(screen.getByPlaceholderText("Sports"));

    const ride = await screen.findByRole("option", { name: "Ride" });
    await user.click(ride);

    expect(onValueChange).toHaveBeenCalled();
    expect(onValueChange.mock.calls.at(-1)![0]).toContain("Ride");
  });
});
