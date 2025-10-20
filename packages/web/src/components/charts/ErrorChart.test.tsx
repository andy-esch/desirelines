/**
 * Tests for ErrorChart component
 *
 * Presentation component that displays error messages with retry functionality.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorChart from "./ErrorChart";

describe("ErrorChart", () => {
  const mockError = new Error("Network request failed");
  const mockRetry = vi.fn();

  it("displays error message from Error object", () => {
    render(<ErrorChart error={mockError} onRetry={mockRetry} />);

    expect(screen.getByText("Failed to load chart data")).toBeInTheDocument();
    expect(screen.getByText("Network request failed")).toBeInTheDocument();
  });

  it("renders with alert role for accessibility", () => {
    render(<ErrorChart error={mockError} onRetry={mockRetry} />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveClass("alert", "alert-danger");
  });

  it("shows retry button", () => {
    render(<ErrorChart error={mockError} onRetry={mockRetry} />);

    const retryButton = screen.getByRole("button", { name: /retry/i });
    expect(retryButton).toBeInTheDocument();
  });

  it("calls onRetry callback when retry button clicked", async () => {
    const user = userEvent.setup();
    render(<ErrorChart error={mockError} onRetry={mockRetry} />);

    const retryButton = screen.getByRole("button", { name: /retry/i });
    await user.click(retryButton);

    expect(mockRetry).toHaveBeenCalledTimes(1);
  });

  it("displays different error messages correctly", () => {
    const customError = new Error("Database connection timeout");
    render(<ErrorChart error={customError} onRetry={mockRetry} />);

    expect(screen.getByText("Database connection timeout")).toBeInTheDocument();
  });

  it("handles multiple clicks on retry button", async () => {
    const user = userEvent.setup();
    const retryHandler = vi.fn();
    render(<ErrorChart error={mockError} onRetry={retryHandler} />);

    const retryButton = screen.getByRole("button", { name: /retry/i });
    await user.click(retryButton);
    await user.click(retryButton);
    await user.click(retryButton);

    expect(retryHandler).toHaveBeenCalledTimes(3);
  });
});
