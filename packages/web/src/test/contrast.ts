import { parseRgb } from "../utils/colorTokens";

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG contrast between two opaque colors written as hex or `rgb()`. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (color: string) => {
    const rgb = parseRgb(color);
    if (!rgb) throw new Error(`not an opaque color: ${color}`);
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  };
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
