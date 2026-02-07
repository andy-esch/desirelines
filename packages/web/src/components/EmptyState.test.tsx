import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  describe("default rendering", () => {
    it("renders neon 'No data available' heading", () => {
      render(
        <MemoryRouter>
          <EmptyState />
        </MemoryRouter>
      );

      expect(screen.getByText("No")).toBeInTheDocument();
      expect(screen.getByText("data")).toBeInTheDocument();
      expect(screen.getByText("available")).toBeInTheDocument();
    });

    it("shows default subtitle when no sport/year provided", () => {
      render(
        <MemoryRouter>
          <EmptyState />
        </MemoryRouter>
      );

      expect(screen.getByText("No data available")).toBeInTheDocument();
    });
  });

  describe("sport and year context", () => {
    it("shows sport-specific message for distance sports", () => {
      render(
        <MemoryRouter>
          <EmptyState sport="cycling" year={2025} unit="miles" />
        </MemoryRouter>
      );

      expect(screen.getByText("No cycling activities recorded for 2025")).toBeInTheDocument();
    });

    it("shows sessions wording for session-based sports", () => {
      render(
        <MemoryRouter>
          <EmptyState sport="yoga" year={2025} unit="sessions" />
        </MemoryRouter>
      );

      expect(screen.getByText("No yoga sessions recorded for 2025")).toBeInTheDocument();
    });

    it("uses custom message when provided", () => {
      render(
        <MemoryRouter>
          <EmptyState sport="cycling" year={2025} message="Custom empty message" />
        </MemoryRouter>
      );

      expect(screen.getByText("Custom empty message")).toBeInTheDocument();
    });
  });

  describe("suggested year link", () => {
    it("renders suggested year link when sport and suggestedYear provided", () => {
      render(
        <MemoryRouter>
          <EmptyState sport="cycling" year={2026} suggestedYear={2025} />
        </MemoryRouter>
      );

      const link = screen.getByRole("link", { name: /View 2025 instead/ });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", "/cycling/2025");
    });

    it("does not render link when suggestedYear is undefined", () => {
      render(
        <MemoryRouter>
          <EmptyState sport="cycling" year={2025} />
        </MemoryRouter>
      );

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("does not render link when sport is undefined", () => {
      render(
        <MemoryRouter>
          <EmptyState suggestedYear={2025} />
        </MemoryRouter>
      );

      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("linkPrefix", () => {
    it("defaults to no prefix on suggested year link", () => {
      render(
        <MemoryRouter>
          <EmptyState sport="running" year={2026} suggestedYear={2025} />
        </MemoryRouter>
      );

      const link = screen.getByRole("link", { name: /View 2025 instead/ });
      expect(link).toHaveAttribute("href", "/running/2025");
    });

    it("prepends linkPrefix to suggested year link for demo mode", () => {
      render(
        <MemoryRouter>
          <EmptyState sport="running" year={2026} suggestedYear={2025} linkPrefix="/demo" />
        </MemoryRouter>
      );

      const link = screen.getByRole("link", { name: /View 2025 instead/ });
      expect(link).toHaveAttribute("href", "/demo/running/2025");
    });
  });
});
