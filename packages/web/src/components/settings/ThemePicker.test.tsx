import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemePicker } from "./ThemePicker";
import { ThemeProvider } from "../../contexts/ThemeContext";
import { THEME_STORAGE_KEY, VISIBLE_THEMES, type ThemePreference } from "../../themes/registry";

function renderPicker(stored: ThemePreference) {
  localStorage.setItem(THEME_STORAGE_KEY, stored);
  return render(
    <ThemeProvider>
      <span id="theme-label">Theme</span>
      <span id="theme-caption">Saved on this device</span>
      <ThemePicker labelledBy="theme-label" describedBy="theme-caption" />
    </ThemeProvider>
  );
}

describe("ThemePicker", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => document.documentElement.removeAttribute("data-theme"));

  it("is a radio group named and described by its row, with one card per picker theme", () => {
    renderPicker("miami");
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toHaveAccessibleDescription("Saved on this device");
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.getAttribute("value"))
    ).toEqual(VISIBLE_THEMES.map((t) => t.id));
    for (const theme of VISIBLE_THEMES) {
      expect(within(group).getByRole("radio", { name: theme.label })).toBeInTheDocument();
    }
  });

  it("checks the chosen theme's card, and badges it", () => {
    renderPicker("arcade");
    expect(screen.getByRole("radio", { name: "Arcade" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Miami" })).not.toBeChecked();
    const frames = document.querySelectorAll("[data-selected]");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.closest("label")).toHaveTextContent("Arcade");
    expect(frames[0]?.querySelector("svg")).not.toBeNull();
  });

  it("applies a theme as soon as its card is chosen", async () => {
    const user = userEvent.setup();
    renderPicker("miami");
    await user.click(screen.getByRole("radio", { name: "Light" }));

    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("legacy-light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("legacy-light");
  });

  it("checks nothing for a preference no card offers", () => {
    // "system" survives from before the picker dropped it; no card claims it.
    renderPicker("system");
    expect(screen.queryByRole("radio", { checked: true })).toBeNull();
  });
});
