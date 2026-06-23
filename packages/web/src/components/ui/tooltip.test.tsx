import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./tooltip";

describe("Tooltip", () => {
  it("shows content on trigger focus (within a provider)", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger>Info</TooltipTrigger>
          <TooltipContent>Zoom to fit</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    expect(screen.queryByText("Zoom to fit")).not.toBeInTheDocument();

    await user.tab(); // focus the trigger
    expect(screen.getByRole("button", { name: "Info" })).toHaveFocus();
    expect(await screen.findByText("Zoom to fit")).toBeInTheDocument();
  });
});
