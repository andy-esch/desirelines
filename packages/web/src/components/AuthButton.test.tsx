import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthButton from "./AuthButton";
import { useAuth } from "../hooks/useAuth";

vi.mock("../hooks/useAuth", () => ({ useAuth: vi.fn() }));

function authState(overrides: Partial<ReturnType<typeof useAuth>>) {
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    loading: false,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  });
}

describe("AuthButton", () => {
  it("shows a failed sign-in as the shared inline message", () => {
    authState({ error: new Error("Popup closed") });
    render(<AuthButton />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Popup closed");
    // InlineAlert's danger message, not a bare line of red text.
    expect(alert.className).toContain("bg-danger/10");
  });

  it("shows a failed sign-out the same way", () => {
    authState({
      user: { uid: "athlete" } as ReturnType<typeof useAuth>["user"],
      error: new Error("Network error"),
    });
    render(<AuthButton />);

    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
    expect(screen.getByRole("alert").className).toContain("bg-danger/10");
  });

  it("shows no message without an error", () => {
    authState({});
    render(<AuthButton />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
