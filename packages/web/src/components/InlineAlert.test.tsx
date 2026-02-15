import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineAlert } from "./InlineAlert";

describe("InlineAlert", () => {
  it("renders children as alert content", () => {
    render(<InlineAlert>Something went wrong</InlineAlert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("defaults to danger variant", () => {
    render(<InlineAlert>Error</InlineAlert>);

    expect(screen.getByRole("alert")).toHaveClass("alert-danger");
  });

  it("renders warning variant", () => {
    render(<InlineAlert variant="warning">Warning text</InlineAlert>);

    expect(screen.getByRole("alert")).toHaveClass("alert-warning");
  });

  it("renders info variant", () => {
    render(<InlineAlert variant="info">Info text</InlineAlert>);

    expect(screen.getByRole("alert")).toHaveClass("alert-info");
  });

  it("applies small size classes", () => {
    render(<InlineAlert size="sm">Small alert</InlineAlert>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("py-1", "px-2", "text-sm");
  });

  it("does not apply small size classes by default", () => {
    render(<InlineAlert>Default alert</InlineAlert>);

    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveClass("py-1");
  });

  it("shows dismiss button when onDismiss provided", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(<InlineAlert onDismiss={onDismiss}>Dismissible</InlineAlert>);

    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    expect(dismissBtn).toBeInTheDocument();

    await user.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not show dismiss button when onDismiss not provided", () => {
    render(<InlineAlert>Not dismissible</InlineAlert>);

    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it("shows retry button when onRetry provided", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();

    render(<InlineAlert onRetry={onRetry}>Retryable</InlineAlert>);

    const retryBtn = screen.getByRole("button", { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    await user.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not show retry button when onRetry not provided", () => {
    render(<InlineAlert>No retry</InlineAlert>);

    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("applies custom className", () => {
    render(<InlineAlert className="mb-4">With class</InlineAlert>);

    expect(screen.getByRole("alert")).toHaveClass("mb-4");
  });
});
