import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import KPICard from "./KPICard";

describe("KPICard", () => {
  it("renders title, value, and subtitle", () => {
    render(
      <KPICard title="Current Distance" value="2450 mi" subtitle="8.3 mi/day avg · 295 days" />
    );

    expect(screen.getByText("Current Distance")).toBeInTheDocument();
    expect(screen.getByText("2450 mi")).toBeInTheDocument();
    expect(screen.getByText(/8.3 mi\/day avg/)).toBeInTheDocument();
  });

  it("renders with numeric value", () => {
    render(<KPICard title="Progress" value={85} subtitle="To goal" />);

    expect(screen.getByText("85")).toBeInTheDocument();
  });

  it("renders optional indicator", () => {
    render(
      <KPICard
        title="Current Distance"
        value="2450 mi"
        subtitle="8.3 mi/day avg"
        indicator={<span data-testid="indicator">↑</span>}
      />
    );

    expect(screen.getByTestId("indicator")).toBeInTheDocument();
    expect(screen.getByText("↑")).toBeInTheDocument();
  });

  it("renders without indicator when not provided", () => {
    render(<KPICard title="Test" value="100" subtitle="subtitle" />);

    // Should not crash and should render basic content
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("renders with JSX subtitle", () => {
    render(
      <KPICard
        title="Test"
        value="100"
        subtitle={
          <>
            First <strong>bold</strong> text
          </>
        }
      />
    );

    expect(screen.getByText(/First/)).toBeInTheDocument();
    expect(screen.getByText(/bold/)).toBeInTheDocument();
    expect(screen.getByText(/text/)).toBeInTheDocument();
  });
});
