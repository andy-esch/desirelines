import { screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import Sidebar from "./Sidebar";
import { TestServiceProvider } from "../../contexts/ServiceContext";
import { TestAuthProvider } from "../../contexts/AuthContext";
import { renderWithRouter } from "../../test/renderWithRouter";

describe("Sidebar", () => {
  const defaultProps = {
    estimatedYearEnd: 1000,
    currentValue: 500,
    unit: "miles" as const,
    filtersSlot: <div data-testid="filters-slot">Filters Content</div>,
    goalsSlot: <div data-testid="goals-slot">Goals Content</div>,
  };

  const renderSidebar = async (props = defaultProps) => {
    return await renderWithRouter(<Sidebar {...props} />, {
      wrapper: ({ children }) => (
        <TestServiceProvider>
          <TestAuthProvider>{children}</TestAuthProvider>
        </TestServiceProvider>
      ),
    });
  };

  it("renders progress summary with correct values", async () => {
    await renderSidebar();
    expect(screen.getByText("500 miles")).toBeInTheDocument();
    expect(screen.getByText("1,000 miles")).toBeInTheDocument();
  });

  it("renders slots content correctly", async () => {
    await renderSidebar();
    expect(screen.getByTestId("filters-slot")).toBeInTheDocument();
    expect(screen.getByTestId("goals-slot")).toBeInTheDocument();
  });

  it("renders sections with correct titles", async () => {
    await renderSidebar();
    expect(screen.getByText("Filters")).toBeInTheDocument();
    expect(screen.getByText("Goals")).toBeInTheDocument();
  });
});
