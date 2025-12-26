import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Navigation from "./Navigation";

const renderWithRouter = (ui: React.ReactElement, { route = "/" } = {}) => {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
};

describe("Navigation", () => {
  describe("horizontal layout (default)", () => {
    it("renders Dashboard link", () => {
      renderWithRouter(<Navigation />);
      expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    });

    it("renders Activities dropdown button", () => {
      renderWithRouter(<Navigation />);
      expect(screen.getByRole("button", { name: "Activities" })).toBeInTheDocument();
    });

    it("renders sport links in dropdown", () => {
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

    it("highlights Activities dropdown when on sport route", () => {
      renderWithRouter(<Navigation />, { route: "/cycling/2025" });
      const activitiesButton = screen.getByRole("button", { name: "Activities" });
      expect(activitiesButton).toHaveClass("active");
    });

    it("does not highlight Activities dropdown when on dashboard", () => {
      renderWithRouter(<Navigation />, { route: "/" });
      const activitiesButton = screen.getByRole("button", { name: "Activities" });
      expect(activitiesButton).not.toHaveClass("active");
    });
  });

  describe("vertical layout", () => {
    it("renders Dashboard link", () => {
      renderWithRouter(<Navigation vertical />);
      expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    });

    it("renders Activities section header", () => {
      renderWithRouter(<Navigation vertical />);
      expect(screen.getByText("Activities")).toBeInTheDocument();
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
      renderWithRouter(<Navigation vertical />, { route: "/running/2025" });
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
