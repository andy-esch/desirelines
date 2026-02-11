import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Navigation from "./Navigation";
import { TestServiceProvider } from "../../contexts/ServiceContext";
import { TestAuthProvider } from "../../contexts/AuthContext";

const renderWithRouter = (ui: React.ReactElement, { route = "/" } = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TestServiceProvider>
      <TestAuthProvider>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
        </QueryClientProvider>
      </TestAuthProvider>
    </TestServiceProvider>
  );
};

describe("Navigation", () => {
  describe("horizontal layout (default)", () => {
    it("renders Dashboard link", () => {
      renderWithRouter(<Navigation />);
      expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    });

    it("renders Activities link", () => {
      renderWithRouter(<Navigation />);
      expect(screen.getByRole("link", { name: "Activities" })).toBeInTheDocument();
    });

    it("renders Goals dropdown button", () => {
      renderWithRouter(<Navigation />);
      expect(screen.getByRole("button", { name: "Goals" })).toBeInTheDocument();
    });

    it("renders sport links in Goals dropdown", () => {
      renderWithRouter(<Navigation />);
      expect(screen.getByRole("link", { name: /Cycling/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Running/ })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Yoga/ })).toBeInTheDocument();
    });

    it("highlights Dashboard when on root route", () => {
      renderWithRouter(<Navigation />, { route: "/" });
      const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
      expect(dashboardLink).toHaveClass("active");
    });

    it("highlights Goals dropdown when on sport route", () => {
      const currentYear = new Date().getFullYear();
      renderWithRouter(<Navigation />, { route: `/cycling/${currentYear}` });
      const goalsButton = screen.getByRole("button", { name: "Goals" });
      expect(goalsButton).toHaveClass("active");
    });

    it("highlights Activities link when on activities page", () => {
      renderWithRouter(<Navigation />, { route: "/activities" });
      const activitiesLink = screen.getByRole("link", { name: "Activities" });
      expect(activitiesLink).toHaveClass("active");
    });

    it("does not highlight Goals dropdown when on dashboard", () => {
      renderWithRouter(<Navigation />, { route: "/" });
      const goalsButton = screen.getByRole("button", { name: "Goals" });
      expect(goalsButton).not.toHaveClass("active");
    });
  });

  describe("vertical layout", () => {
    it("renders Dashboard link", () => {
      renderWithRouter(<Navigation vertical />);
      expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    });

    it("renders Activities link", () => {
      renderWithRouter(<Navigation vertical />);
      expect(screen.getByRole("link", { name: "Activities" })).toBeInTheDocument();
    });

    it("renders Goals section header", () => {
      renderWithRouter(<Navigation vertical />);
      expect(screen.getByText("Goals")).toBeInTheDocument();
    });

    it("renders all sport links directly (no dropdown)", () => {
      renderWithRouter(<Navigation vertical />);
      const cyclingLinks = screen.getAllByRole("link", { name: /Cycling/ });
      const runningLinks = screen.getAllByRole("link", { name: /Running/ });
      const yogaLinks = screen.getAllByRole("link", { name: /Yoga/ });

      expect(cyclingLinks.length).toBeGreaterThan(0);
      expect(runningLinks.length).toBeGreaterThan(0);
      expect(yogaLinks.length).toBeGreaterThan(0);
    });

    it("highlights active sport link", () => {
      const currentYear = new Date().getFullYear();
      renderWithRouter(<Navigation vertical />, { route: `/running/${currentYear}` });
      const runningLinks = screen.getAllByRole("link", { name: /Running/ });
      const activeLink = runningLinks.find((link) => link.classList.contains("active"));
      expect(activeLink).toBeTruthy();
    });
  });

  describe("sport links", () => {
    it("links to current year for each sport", () => {
      const currentYear = new Date().getFullYear();
      renderWithRouter(<Navigation />);

      expect(screen.getByRole("link", { name: /Cycling/ })).toHaveAttribute(
        "href",
        `/cycling/${currentYear}`
      );
      expect(screen.getByRole("link", { name: /Running/ })).toHaveAttribute(
        "href",
        `/running/${currentYear}`
      );
      expect(screen.getByRole("link", { name: /Yoga/ })).toHaveAttribute(
        "href",
        `/yoga/${currentYear}`
      );
    });
  });
});
