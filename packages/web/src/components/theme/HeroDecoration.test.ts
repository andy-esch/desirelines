import { describe, it, expect } from "vitest";
import tailwindCss from "../../css/tailwind.css?raw";
import { SUNSET_STOPS } from "./HeroDecoration";

const miamiBlock = tailwindCss.match(/\[data-theme="miami"\]\s*\{([^}]*)\}/)?.[1] ?? "";
const slot = (name: string) =>
  miamiBlock.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))?.[1]?.trim() ?? "";

const channel = (hex: string, i: number) => {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
const contrast = (a: string, b: string) => {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

describe("Miami sunset", () => {
  it("keeps 4.5:1 between the hero text and every band text can sit on", () => {
    const ink = slot("--hero-ink");
    expect(ink).toMatch(/^#[0-9a-f]{6}$/i);
    for (const stop of SUNSET_STOPS.filter((s) => s.behindText)) {
      expect(contrast(ink, stop.color), `${ink} on ${stop.color}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the lighter bands inside the bottom padding that content never enters", () => {
    const bottomPadding = parseFloat(slot("--hero-padding").split(/\s+/)[2] ?? "");
    for (const stop of SUNSET_STOPS.filter((s) => !s.behindText)) {
      const offset = parseFloat(stop.from.match(/100% - (\d+)px/)?.[1] ?? "NaN");
      expect(offset, `${stop.color} starts ${stop.from}`).toBeLessThanOrEqual(bottomPadding);
    }
  });
});
