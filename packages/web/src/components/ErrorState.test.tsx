import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorState } from "./ErrorState";
import { NextHeadingLevel } from "./theme/NextHeadingLevel";
import { Panel } from "./theme/Panel";

describe("ErrorState", () => {
  it("announces a danger title over the detail, in the theme's error slots", () => {
    render(<ErrorState title="Error loading activities">Network request failed.</ErrorState>);

    const alert = screen.getByRole("alert");
    const title = screen.getByRole("heading", { name: "Error loading activities" });
    expect(alert).toContainElement(title);
    expect(alert).toHaveTextContent("Network request failed.");
    expect(title).toHaveClass("text-danger");
    for (const slot of ["weight", "case", "tracking", "shadow"]) {
      expect(title.className).toContain(`--error-title-${slot}`);
    }
  });

  it("offers the shared Retry button only when a retry is given", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState title="Error loading goals" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<ErrorState title="Error loading goals" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("puts other ways out after Retry", () => {
    render(
      <ErrorState title="Something went wrong" onRetry={() => {}} actions={<a href="/">Home</a>} />
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    const home = screen.getByRole("link", { name: "Home" });
    expect(retry.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("titles at the outline's level, or the page's h1 when it stands in for a page", () => {
    const { unmount } = render(
      <NextHeadingLevel>
        <ErrorState title="Error loading chart data" />
      </NextHeadingLevel>
    );
    expect(screen.getByRole("heading", { level: 3 })).toBeInTheDocument();
    unmount();

    render(<ErrorState title="Something went wrong" level={1} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("Panel tone", () => {
  it("frames a panel showing an error from the theme's error slots, falling back to its own", () => {
    const { container } = render(
      <Panel tone="danger" accent={2}>
        body
      </Panel>
    );
    const frame = container.querySelector("section")!;
    expect(frame.className).toContain("var(--error-frame-color,var(--panel-accent-2))");
    expect(frame.className).toContain("var(--error-frame-shadow,var(--panel-shadow))");
    expect(frame.className).not.toContain("hover:border");
  });
});
