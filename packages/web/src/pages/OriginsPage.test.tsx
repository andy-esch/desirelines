import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import OriginsPage from "./OriginsPage";
import { renderWithRouter } from "../test/renderWithRouter";

describe("OriginsPage", () => {
  it("renders without errors", async () => {
    await renderWithRouter(<OriginsPage />);

    expect(screen.getByRole("heading", { name: "Origins" })).toBeInTheDocument();
  });

  it("displays the project description section", async () => {
    await renderWithRouter(<OriginsPage />);

    expect(screen.getByText("What is Desirelines?")).toBeInTheDocument();
  });

  it("displays the name explanation section", async () => {
    await renderWithRouter(<OriginsPage />);

    expect(screen.getByText("The Name")).toBeInTheDocument();
    expect(screen.getByText(/desire line/i)).toBeInTheDocument();
  });

  it("displays the open source section with GitHub link", async () => {
    await renderWithRouter(<OriginsPage />);

    expect(screen.getByText("Open Source")).toBeInTheDocument();
    const githubLink = screen.getByRole("link", { name: /View on GitHub/i });
    expect(githubLink).toHaveAttribute("href", "https://github.com/andy-esch/desirelines/");
    expect(githubLink).toHaveAttribute("target", "_blank");
  });

  it("has a back to dashboard link", async () => {
    await renderWithRouter(<OriginsPage />);

    expect(screen.getByText(/Back to Dashboard/)).toBeInTheDocument();
  });
});
