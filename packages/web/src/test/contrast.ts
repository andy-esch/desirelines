/** A color's sRGB channels (0 to 255) and alpha (0 to 1). */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Parse the color forms theme files write: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` and
 * `rgba()` with commas or spaces and a `/` alpha, and `transparent`. Null for anything else.
 */
export function parseRgba(color: string): Rgba | null {
  const value = color.trim().toLowerCase();
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = value.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const channel = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
    return {
      r: channel(0),
      g: channel(1),
      b: channel(2),
      a: full.length === 8 ? channel(3) / 255 : 1,
    };
  }
  const fn = value.match(
    /^rgba?\(\s*([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*,\s*|\s+)([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/
  );
  if (fn) {
    const alpha = fn[4] === undefined ? 1 : Number(fn[4]) / (fn[5] ? 100 : 1);
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: alpha };
  }
  return null;
}

/** `top` painted over `under`, as the browser blends a translucent color. */
export function composite(top: Rgba, under: Rgba): Rgba {
  const mix = (t: number, u: number) => t * top.a + u * (1 - top.a);
  return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: 1 };
}

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ({ r, g, b }: Rgba) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG contrast between two opaque colors. */
export function contrastBetween(a: Rgba, b: Rgba): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** WCAG contrast between two opaque colors written as hex or `rgb()`. */
export function contrastRatio(a: string, b: string): number {
  const parse = (color: string) => {
    const rgba = parseRgba(color);
    if (!rgba || rgba.a < 1) throw new Error(`not an opaque color: ${color}`);
    return rgba;
  };
  return contrastBetween(parse(a), parse(b));
}
