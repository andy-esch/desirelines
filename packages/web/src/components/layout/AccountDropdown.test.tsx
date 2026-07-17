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

  it("ArrowDown on a focused menu item moves to the next item, not back to the first", () => {
    // Regression: the outer wrapper's ArrowDown handler used to fire for every
    // ArrowDown while open (the event bubbles up from the menu), resetting focus
    // to the first item — so you could never navigate past it. The handler is now
    // gated to the trigger, so intra-menu ArrowDown is owned solely by the menu.
    const onSignIn = vi.fn().mockResolvedValue(undefined);
    const onSignOut = vi.fn().mockResolvedValue(undefined);

    render(
      <AccountDropdown user={{ uid: "abc" } as never} onSignIn={onSignIn} onSignOut={onSignOut} />
    );

    openMenu();
    // Enumerate the whole menuitem family in DOM order, not just role="menuitem":
    // the theme picker's buttons are `menuitemradio` (single-select group) and sit
    // between the plain items, so they're part of the arrow-key sequence the
    // component navigates. Querying only "menuitem" would skip them and test a
    // narrower path than the user walks.
    const items = Array.from(
      screen
        .getByRole("menu")
        .querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')
    );
    expect(items.length).toBeGreaterThanOrEqual(3);

    const secondToLast = items.at(-2);
    const last = items.at(-1);
    if (!secondToLast || !last) throw new Error("expected at least two menu items");

    secondToLast.focus();
    fireEvent.keyDown(secondToLast, { key: "ArrowDown" });

    // Fixed: advances to the next (last) item. Buggy: would reset to items[0].
    expect(document.activeElement).toBe(last);
    expect(document.activeElement).not.toBe(items[0]);
  });

  it("exposes the active theme programmatically, not just visually", () => {
    // The active theme was conveyed only by border/background colour, so a screen
    // reader user couldn't tell which was selected. useTheme is mocked to "system".
    const onSignIn = vi.fn().mockResolvedValue(undefined);
    const onSignOut = vi.fn().mockResolvedValue(undefined);

    render(
      <AccountDropdown user={{ uid: "abc" } as never} onSignIn={onSignIn} onSignOut={onSignOut} />
    );

    openMenu();

    const themeGroup = screen.getByRole("group", { name: /theme/i });
    expect(themeGroup).toBeInTheDocument();

    const radios = screen.getAllByRole("menuitemradio");
    expect(radios).toHaveLength(3);

    expect(screen.getByRole("menuitemradio", { name: /system theme/i })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    for (const name of [/light theme/i, /dark theme/i]) {
      expect(screen.getByRole("menuitemradio", { name })).toHaveAttribute("aria-checked", "false");
    }
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
