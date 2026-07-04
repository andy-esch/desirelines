import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AccountDropdown } from "./AccountDropdown";

// Link needs a router context we don't set up here — render it as a plain
// anchor so the dropdown mounts in isolation.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("../../hooks/useUserProfile", () => ({
  useUserProfile: () => ({ displayName: "Guest", loading: false, profile: null, error: null }),
}));

vi.mock("../../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

describe("AccountDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const openMenu = () => {
    fireEvent.click(screen.getByRole("button", { name: /account menu/i }));
  };

  it("toggles actionLoading during sign-in and closes the menu on success", async () => {
    // Controllable promise so we can observe the pending (actionLoading) state.
    let resolveSignIn!: () => void;
    const onSignIn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSignIn = resolve;
        })
    );
    const onSignOut = vi.fn().mockResolvedValue(undefined);

    render(<AccountDropdown user={null} onSignIn={onSignIn} onSignOut={onSignOut} />);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /sign in/i }));

    // actionLoading true: the callback fired and the button flips to the
    // pending label + disabled.
    expect(onSignIn).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /signing in/i })).toBeDisabled();
    });

    // Resolving the action closes the menu (setIsOpen(false)) and clears loading.
    await act(async () => {
      resolveSignIn();
    });
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: /sign in/i })).not.toBeInTheDocument();
    });
  });

  it("closes the menu after a successful sign-out", async () => {
    const onSignIn = vi.fn().mockResolvedValue(undefined);
    const onSignOut = vi.fn().mockResolvedValue(undefined);

    render(
      <AccountDropdown user={{ uid: "abc" } as never} onSignIn={onSignIn} onSignOut={onSignOut} />
    );

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: /sign out/i })).not.toBeInTheDocument();
    });
  });
});
