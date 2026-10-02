import { describe, it, expect, onTestFinished, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardErrorBoundary } from "./CardErrorBoundary";

describe("CardErrorBoundary", () => {
  it("replaces a card that throws with a danger-toned error, and Retry draws it again", async () => {
    let crash = true;
    function Card() {
      if (crash) throw new Error("bad week");
      return <p>card</p>;
    }
    // React reports the caught error; keep it out of the test output.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => quiet.mockRestore());
    const { container } = render(
      <CardErrorBoundary>
        <Card />
      </CardErrorBoundary>
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/Error displaying this card.*bad week/);
    expect(container.querySelector("section")?.className).toContain("--error-frame-color");

    crash = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("card")).toBeInTheDocument();
  });

  it("renders the card untouched when it doesn't throw", () => {
    render(
      <CardErrorBoundary>
        <p>card</p>
      </CardErrorBoundary>
    );
    expect(screen.getByText("card")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
