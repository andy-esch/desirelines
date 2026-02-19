import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageErrorFallback } from "./PageErrorFallback";
import { renderWithRouter } from "../test/renderWithRouter";

describe("PageErrorFallback", () => {
  const mockError = new Error("Component render failed");

  it("displays error message", async () => {
    await renderWithRouter(<PageErrorFallback error={mockError} onReset={vi.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/Component render failed/)).toBeInTheDocument();
  });

  it("renders try again button that calls onReset", async () => {
    const onReset = vi.fn();
    const user = userEvent.setup();

    await renderWithRouter(<PageErrorFallback error={mockError} onReset={onReset} />);

    const tryAgainBtn = screen.getByRole("button", { name: /try again: retry loading this page/i });
    await user.click(tryAgainBtn);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("renders dashboard link", async () => {
    await renderWithRouter(<PageErrorFallback error={mockError} onReset={vi.fn()} />);

    const dashboardLink = screen.getByRole("link", { name: /go to dashboard/i });
    expect(dashboardLink).toHaveAttribute("href", "/");
  });
});
