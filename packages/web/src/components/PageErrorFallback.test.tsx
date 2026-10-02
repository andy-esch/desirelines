import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageErrorFallback } from "./PageErrorFallback";
import { NextHeadingLevel } from "./theme/NextHeadingLevel";
import { renderWithRouter } from "../test/renderWithRouter";

describe("PageErrorFallback", () => {
  const mockError = new Error("Component render failed");

  it("displays error message", async () => {
    await renderWithRouter(<PageErrorFallback error={mockError} onReset={vi.fn()} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/Component render failed/)).toBeInTheDocument();
  });

  it("titles the page it stands in for with its h1", async () => {
    await renderWithRouter(<PageErrorFallback error={mockError} onReset={vi.fn()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" })
    ).toBeInTheDocument();
  });

  it("puts an inline error's title at the outline's current level", async () => {
    await renderWithRouter(
      <NextHeadingLevel>
        <PageErrorFallback error={mockError} variant="inline" />
      </NextHeadingLevel>
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Error loading chart data" })
    ).toBeInTheDocument();
  });

  it("renders the shared Retry button, which calls onReset", async () => {
    const onReset = vi.fn();
    const user = userEvent.setup();

    await renderWithRouter(<PageErrorFallback error={mockError} onReset={onReset} />);

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("renders dashboard link", async () => {
    await renderWithRouter(<PageErrorFallback error={mockError} onReset={vi.fn()} />);

    const dashboardLink = screen.getByRole("link", { name: /go to dashboard/i });
    expect(dashboardLink).toHaveAttribute("href", "/");
  });

  it("displays non-Error string error message", async () => {
    await renderWithRouter(
      <PageErrorFallback error="Failed to fetch resource" onReset={vi.fn()} />
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText(/Failed to fetch resource/)).toBeInTheDocument();
  });

  it("displays non-Error object error message in inline variant", async () => {
    await renderWithRouter(
      <PageErrorFallback error={{ code: 500 }} variant="inline" onReset={vi.fn()} />
    );

    expect(screen.getByText("Error loading chart data")).toBeInTheDocument();
    expect(screen.getByText(/\[object Object\]/)).toBeInTheDocument();
  });

  it("frames a page-level error in a danger-toned panel, with no link outside the router", async () => {
    const { container } = await renderWithRouter(
      <PageErrorFallback error={mockError} onReset={vi.fn()} variant="full" />
    );

    expect(container.querySelector("section")?.className).toContain("--error-frame-color");
    expect(
      screen.getByRole("heading", { level: 1, name: "Something went wrong" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
