import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoBanner } from "./DemoBanner";

describe("DemoBanner", () => {
  it("says the data is generated and sign-in is invite-only, in the demo slots", () => {
    const { container } = render(<DemoBanner />);

    expect(container).toHaveTextContent(
      "Demo Mode — Viewing generated sample data. Sign-in is invite-only."
    );
    expect(screen.getByText("Demo Mode").className).toContain("--demo-label-color");
    expect((container.firstElementChild as HTMLElement).className).toContain("--demo-bg");
  });

  it("is page chrome, not an announcement", () => {
    render(<DemoBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
