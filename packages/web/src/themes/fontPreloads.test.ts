import { describe, it, expect, afterEach } from "vitest";
import { preloadThemeFonts } from "./fontPreloads";
import { getTheme, THEMES } from "./registry";

function preloadedHrefs(): string[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')].map(
    (link) => link.getAttribute("href") ?? ""
  );
}

describe("preloadThemeFonts", () => {
  afterEach(() => {
    document.head.querySelectorAll('link[rel="preload"]').forEach((link) => link.remove());
    document.documentElement.removeAttribute("data-theme");
  });

  it("preloads one woff2 per weight the applied theme names", () => {
    document.documentElement.dataset.theme = "miami";
    preloadThemeFonts(document);

    const weights = getTheme("miami").fonts.reduce((n, font) => n + font.weights.length, 0);
    const links = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="preload"]')];
    expect(links).toHaveLength(weights);
    for (const link of links) {
      expect(link.as).toBe("font");
      expect(link.type).toBe("font/woff2");
      expect(link.crossOrigin).toBe("anonymous");
      expect(link.getAttribute("href")).toMatch(/\.woff2/);
    }
    expect(new Set(preloadedHrefs()).size).toBe(weights);
  });

  it("preloads nothing for a theme on the system font stack", () => {
    document.documentElement.dataset.theme = "legacy-light";
    preloadThemeFonts(document);

    expect(preloadedHrefs()).toEqual([]);
  });

  it("preloads nothing when no theme has been applied", () => {
    preloadThemeFonts(document);

    expect(preloadedHrefs()).toEqual([]);
  });

  it("preloads the faces Miami's headlines and body text need", () => {
    document.documentElement.dataset.theme = "miami";
    preloadThemeFonts(document);

    const hrefs = preloadedHrefs().join(" ");
    expect(hrefs).toContain("archivo-black");
    expect(hrefs).toContain("ibm-plex-mono");
  });

  it("applies to every theme without throwing, whatever faces it names", () => {
    for (const theme of THEMES) {
      document.documentElement.dataset.theme = theme.id;
      expect(() => preloadThemeFonts(document)).not.toThrow();
      document.head.querySelectorAll('link[rel="preload"]').forEach((link) => link.remove());
    }
  });
});
