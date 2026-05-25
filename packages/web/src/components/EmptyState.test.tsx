import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";
import { renderWithRouter } from "../test/renderWithRouter";

// usePublicSportConfig pulls from React Query; stub it so the component can
// resolve display names without a QueryClientProvider in component tests.
vi.mock("../hooks/usePublicSportConfig", () => ({
  usePublicSportConfig: () => ({
    sportConfig: {
      version: "1.0",
      sportCategories: {
        cycling: { displayName: "Cycling" },
        yoga: { displayName: "Yoga" },
      },
    },
    isLoading: false,
    error: null,
    retry: () => undefined,
  }),
}));

describe("EmptyState", () => {
  describe("default rendering", () => {
    it("renders neon 'No data available' heading", async () => {
      await renderWithRouter(<EmptyState />);

      expect(screen.getByText("No")).toBeInTheDocument();
      expect(screen.getByText("data")).toBeInTheDocument();
      expect(screen.getByText("available")).toBeInTheDocument();
    });

    it("shows default subtitle when no sport/year provided", async () => {
      await renderWithRouter(<EmptyState />);

      expect(screen.getByText("No data available")).toBeInTheDocument();
    });
  });

  describe("sport and year context", () => {
    it("shows sport-specific message for distance sports", async () => {
      await renderWithRouter(<EmptyState sport="cycling" year={2025} unit="miles" />);

      expect(screen.getByText("No Cycling activities recorded for 2025")).toBeInTheDocument();
    });

    it("shows sessions wording for session-based sports", async () => {
      await renderWithRouter(<EmptyState sport="yoga" year={2025} unit="sessions" />);

      expect(screen.getByText("No Yoga sessions recorded for 2025")).toBeInTheDocument();
    });

    it("uses custom message when provided", async () => {
      await renderWithRouter(
        <EmptyState sport="cycling" year={2025} message="Custom empty message" />
      );

      expect(screen.getByText("Custom empty message")).toBeInTheDocument();
    });
  });

  describe("suggested year link", () => {
    it("renders suggested year link when sport and suggestedYear provided", async () => {
      await renderWithRouter(<EmptyState sport="cycling" year={2026} suggestedYear={2025} />);

      const link = screen.getByRole("link", { name: /View 2025 instead/ });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/cycling/2025");
    });

    it("does not render link when suggestedYear is undefined", async () => {
      await renderWithRouter(<EmptyState sport="cycling" year={2025} />);

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("does not render link when sport is undefined", async () => {
      await renderWithRouter(<EmptyState suggestedYear={2025} />);

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("linkPrefix", () => {
    it("defaults to no prefix on suggested year link", async () => {
      await renderWithRouter(<EmptyState sport="running" year={2026} suggestedYear={2025} />);

      const link = screen.getByRole("link", { name: /View 2025 instead/ });
      expect(link).toHaveAttribute("href", "/running/2025");
    });

    it("prepends linkPrefix to suggested year link for demo mode", async () => {
      await renderWithRouter(
        <EmptyState sport="running" year={2026} suggestedYear={2025} linkPrefix="/demo" />
      );

      const link = screen.getByRole("link", { name: /View 2025 instead/ });
      expect(link).toHaveAttribute("href", "/demo/running/2025");
    });
  });
});
