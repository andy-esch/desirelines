import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MapInsightsDrawer from "./MapInsightsDrawer";

describe("MapInsightsDrawer", () => {
  it("opens via the edge handle", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <MapInsightsDrawer open={false} onOpenChange={onOpenChange} isDark>
        <div>chart</div>
      </MapInsightsDrawer>
    );
    await user.click(screen.getByRole("button", { name: "Charts" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("collapses via the close control when open", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <MapInsightsDrawer open onOpenChange={onOpenChange} isDark>
        <div>chart</div>
      </MapInsightsDrawer>
    );
    await user.click(screen.getByRole("button", { name: /collapse charts/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders its chart children", () => {
    render(
      <MapInsightsDrawer open onOpenChange={vi.fn()} isDark>
        <div>my chart</div>
      </MapInsightsDrawer>
    );
    expect(screen.getByText("my chart")).toBeInTheDocument();
  });

  it("reflects open state via aria on the handle", () => {
    render(
      <MapInsightsDrawer open={false} onOpenChange={vi.fn()} isDark>
        <div>chart</div>
      </MapInsightsDrawer>
    );
    expect(screen.getByRole("button", { name: "Charts" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });
});
