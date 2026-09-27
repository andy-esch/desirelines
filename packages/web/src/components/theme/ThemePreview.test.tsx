import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ThemePreview } from "./ThemePreview";
import { PLAIN_PREVIEW_BANDS, SUNSET_PREVIEW_BANDS } from "./HeroDecoration";
import { THEMES, getTheme } from "../../themes/registry";

const bandsOf = (el: Element | null) =>
  [...(el?.children ?? [])].map((band) => (band as HTMLElement).style.background);

describe("ThemePreview", () => {
  it("draws inside its own theme, so the slots it reads are that theme's", () => {
    for (const theme of THEMES) {
      const { container, unmount } = render(<ThemePreview theme={theme} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveAttribute("data-theme", theme.id);
      expect(root).toHaveAttribute("aria-hidden", "true");
      expect(root.style.background).toBe("var(--color-bg-body)");
      unmount();
    }
  });

  it("draws its text bars in the theme's accent", () => {
    const theme = getTheme("miami");
    const { container } = render(<ThemePreview theme={theme} />);
    const bars = container.querySelectorAll(":scope > div > span");
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect((bar as HTMLElement).style.background).toBe("rgb(255, 46, 196)");
    }
  });

  it("draws each hero decoration in miniature", () => {
    const decoration = (id: Parameters<typeof getTheme>[0]) =>
      render(<ThemePreview theme={getTheme(id)} />).container.querySelector("[data-decoration]");

    const sunset = decoration("miami");
    expect(sunset).toHaveAttribute("data-decoration", "sunset-preview");
    expect(bandsOf(sunset)).toEqual(
      SUNSET_PREVIEW_BANDS.map((hex) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return `rgb(${r}, ${g}, ${b})`;
      })
    );

    expect(decoration("arcade")).toHaveAttribute("data-decoration", "grid-preview");

    // Light has no decoration: plain bands of its own surfaces.
    const plain = decoration("legacy-light");
    expect(plain).toHaveAttribute("data-decoration", "plain-preview");
    expect(bandsOf(plain)).toEqual(PLAIN_PREVIEW_BANDS);
  });
});
