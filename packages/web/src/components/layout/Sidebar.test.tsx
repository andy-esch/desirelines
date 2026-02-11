import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, it, expect } from "vitest";
import Sidebar from "./Sidebar";
import { TestServiceProvider } from "../../contexts/ServiceContext";
import { TestAuthProvider } from "../../contexts/AuthContext";

describe("Sidebar", () => {
  const defaultProps = {
    estimatedYearEnd: 1000,
    currentValue: 500,
    unit: "miles" as const,
    filtersSlot: <div data-testid="filters-slot">Filters Content</div>,
    goalsSlot: <div data-testid="goals-slot">Goals Content</div>,
  };

  const renderSidebar = (props = defaultProps) => {
    return render(
      <TestServiceProvider>
        <TestAuthProvider>
          <BrowserRouter>
            <Sidebar {...props} />
          </BrowserRouter>
        </TestAuthProvider>
      </TestServiceProvider>
    );
  };

  it("renders progress summary with correct values", () => {
    renderSidebar();
    expect(screen.getByText("500 miles")).toBeInTheDocument();
    expect(screen.getByText("1,000 miles")).toBeInTheDocument();
  });

  it("renders slots content correctly", () => {
    renderSidebar();
    expect(screen.getByTestId("filters-slot")).toBeInTheDocument();
    expect(screen.getByTestId("goals-slot")).toBeInTheDocument();
  });

  it("renders sections with correct titles", () => {
    renderSidebar();
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("Goals")).toBeInTheDocument();
  });
});
