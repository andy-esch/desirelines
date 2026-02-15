import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PageErrorFallback } from "./PageErrorFallback";

describe("PageErrorFallback", () => {
  const mockError = new Error("Component render failed");

  it("displays error message", () => {
    render(
      <MemoryRouter>
        <PageErrorFallback error={mockError} onReset={vi.fn()} />
      </MemoryRouter>
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/Component render failed/)).toBeInTheDocument();
  });

  it("renders try again button that calls onReset", async () => {
    const onReset = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <PageErrorFallback error={mockError} onReset={onReset} />
      </MemoryRouter>
    );

    const tryAgainBtn = screen.getByRole("button", { name: /retry loading this page/i });
    await user.click(tryAgainBtn);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("renders dashboard link", () => {
    render(
      <MemoryRouter>
        <PageErrorFallback error={mockError} onReset={vi.fn()} />
      </MemoryRouter>
    );

    const dashboardLink = screen.getByRole("link", { name: /go to dashboard/i });
    expect(dashboardLink).toHaveAttribute("href", "/");
  });
});
