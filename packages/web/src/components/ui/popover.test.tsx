import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";

describe("Popover", () => {
  it("opens on trigger click and renders portalled content", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open filters</PopoverTrigger>
        <PopoverContent>
          <p>Filter body</p>
        </PopoverContent>
      </Popover>
    );

    expect(screen.queryByText("Filter body")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open filters" }));
    expect(await screen.findByText("Filter body")).toBeInTheDocument();
  });
});
