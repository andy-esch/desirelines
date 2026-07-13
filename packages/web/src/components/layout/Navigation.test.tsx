import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Navigation from "./Navigation";
import { TestServiceProvider } from "../../contexts/ServiceContext";
import { TestAuthProvider } from "../../contexts/AuthContext";
import { renderWithRouter } from "../../test/renderWithRouter";

const renderNav = async (ui: React.ReactElement, { route = "/" } = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return await renderWithRouter(ui, {
    route,
    wrapper: ({ children }) => (
      <TestServiceProvider>
        <TestAuthProvider>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </TestAuthProvider>
      </TestServiceProvider>
    ),
  });
};

describe("Navigation", () => {
  describe("horizontal layout (default)", () => {
    it("renders Dashboard link", async () => {
      await renderNav(<Navigation />);
      expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    });

    it("renders Goals dropdown button", async () => {
      await renderNav(<Navigation />);
      expect(screen.getByRole("button", { name: /Goals/ })).toBeInTheDocument();
    });

    it("renders sport links in Goals dropdown", async () => {
      await renderNav(<Navigation />);
      await userEvent.click(screen.getByRole("button", { name: /Goals/ }));
      // Base UI Menu.LinkItem renders portaled nav links with role="menuitem".
      expect(await screen.findByRole("menuitem", { name: /Cycling/ })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Running/ })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: /Yoga/ })).toBeInTheDocument();
    });

    it("highlights Dashboard when on root route", async () => {
      await renderNav(<Navigation />, { route: "/" });
      expect(screen.getByRole("link", { name: "Dashboard" })).toHaveClass("active");
    });

    it("highlights Goals dropdown when on sport route", async () => {
      const currentYear = new Date().getFullYear();
      await renderNav(<Navigation />, { route: `/cycling/${currentYear}` });
      expect(screen.getByRole("button", { name: /Goals/ })).toHaveClass("active");
    });

    it("does not highlight Goals dropdown when on dashboard", async () => {
      await renderNav(<Navigation />, { route: "/" });
      expect(screen.getByRole("button", { name: /Goals/ })).not.toHaveClass("active");
    });

    // Activities is a dropdown (Routes/Charts/List), shown for everyone incl. demo.
    it("renders an Activities dropdown button", async () => {
      await renderNav(<Navigation />);
      expect(screen.getByRole("button", { name: /Activities/ })).toBeInTheDocument();
    });

    it("lists Routes, Charts, and List under the Activities dropdown", async () => {
      await renderNav(<Navigation />);
      await userEvent.click(screen.getByRole("button", { name: /Activities/ }));
      expect(await screen.findByRole("menuitem", { name: "Routes" })).toHaveAttribute(
        "href",
        "/routes"
      );
      expect(screen.getByRole("menuitem", { name: "Charts" })).toHaveAttribute("href", "/charts");
      expect(screen.getByRole("menuitem", { name: "List" })).toHaveAttribute("href", "/activities");
    });

    it("highlights the Activities dropdown when on one of its views", async () => {
      await renderNav(<Navigation />, { route: "/charts" });
      expect(screen.getByRole("button", { name: /Activities/ })).toHaveClass("active");
    });
  });

  describe("vertical layout", () => {
    it("renders Dashboard link", async () => {
      await renderNav(<Navigation vertical />);
      expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    });

    it("renders Goals section header", async () => {
      await renderNav(<Navigation vertical />);
      expect(screen.getByText("Goals")).toBeInTheDocument();
    });

    it("renders all sport links directly (no dropdown)", async () => {
      await renderNav(<Navigation vertical />);
      expect(screen.getAllByRole("link", { name: /Cycling/ }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: /Running/ }).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("link", { name: /Yoga/ }).length).toBeGreaterThan(0);
    });

    it("highlights active sport link", async () => {
      const currentYear = new Date().getFullYear();
      await renderNav(<Navigation vertical />, { route: `/running/${currentYear}` });
      const runningLinks = screen.getAllByRole("link", { name: /Running/ });
      expect(runningLinks.find((link) => link.classList.contains("active"))).toBeTruthy();
    });

    it("renders the Activities section with its three views", async () => {
      await renderNav(<Navigation vertical />);
      expect(screen.getByText("Activities")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Routes" })).toHaveAttribute("href", "/routes");
      expect(screen.getByRole("link", { name: "Charts" })).toHaveAttribute("href", "/charts");
      expect(screen.getByRole("link", { name: "List" })).toHaveAttribute("href", "/activities");
    });
  });

  describe("sport links", () => {
    it("links to current year for each sport", async () => {
      const currentYear = new Date().getFullYear();
      await renderNav(<Navigation />);
      await userEvent.click(screen.getByRole("button", { name: /Goals/ }));

      expect(await screen.findByRole("menuitem", { name: /Cycling/ })).toHaveAttribute(
        "href",
        `/cycling/${currentYear}`
      );
      expect(screen.getByRole("menuitem", { name: /Running/ })).toHaveAttribute(
        "href",
        `/running/${currentYear}`
      );
      expect(screen.getByRole("menuitem", { name: /Yoga/ })).toHaveAttribute(
        "href",
        `/yoga/${currentYear}`
      );
    });
  });
});
