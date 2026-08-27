/**
 * Helpers for referencing the CSS color-token layer from TypeScript.
 *
 * The color system is layered: primitives (`--color-neon-*`, `--color-brand-*`) are
 * defined once in `css/tailwind.css`, semantic/role tokens derive from them, and
 * components reference tokens — never raw values. These helpers exist so inline
 * styles and chart props can follow that rule without hand-writing `var()` strings.
 *
 * Anything the browser resolves as CSS (DOM styles, SVG attributes, Recharts props)
 * can take a `var(...)` string directly. Consumers that parse colors in JS — Mapbox
 * style expressions, numeric interpolation — cannot, and need a runtime resolver
 * instead.
 */

/**
 * Apply partial opacity to any CSS color expression.
 *
 * `alpha("rgb(0, 255, 255)", 12)` is equivalent to `rgba(0, 255, 255, 0.12)` —
 * mixing N% of a color into transparent yields exactly alpha = N/100.
 *
 * Use this when the color arrives as a value (e.g. a `SPORT_COLORS` entry); use
 * {@link tint} when you have a token name.
 *
 * @param color - any CSS color, including `var(...)` and another `color-mix(...)`
 * @param pct - opacity as a percentage (0-100)
 */
export function alpha(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/**
 * Reference a color token at partial opacity.
 *
 * `tint("--color-neon-cyan", 12)` is equivalent to `rgba(0, 255, 255, 0.12)` when
 * that token holds `rgb(0, 255, 255)`.
 *
 * @param token - CSS custom property name, including the leading `--`
 * @param pct - opacity as a percentage (0-100)
 */
export function tint(token: string, pct: number): string {
  return alpha(`var(${token})`, pct);
}

/**
 * Resolve a color token to a concrete value for consumers that cannot accept
 * `var(...)` — Mapbox GL style expressions, `<meta>` tag content, and anything that
 * parses colors in JS to interpolate them.
 *
 * Reads the live value off `<html>`, so it reflects the current theme. Callers that
 * must update when the theme changes need to re-run this on that change (e.g. by
 * depending on `useTheme().resolvedTheme`) — it is a point-in-time read, not a
 * subscription.
 *
 * @param token - CSS custom property name, including the leading `--`
 * @param fallback - returned when there is no DOM or the token is undefined
 */
export function resolveThemeColor(token: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}

/** Parsed sRGB channels. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a CSS color into channels, accepting the forms our tokens actually hold:
 * `#rgb`, `#rrggbb`, and `rgb()`/`rgba()`. Returns null for anything else, so
 * callers can fall back rather than render a broken color.
 */
/** Clamp a parsed colour channel into the valid 0-255 range. */
function clampChannel(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(255, Math.max(0, Math.round(n)));
}

export function parseRgb(color: string): Rgb | null {
  // Trim once, up front: `getComputedStyle().getPropertyValue()` commonly returns a
  // leading space, and anchoring the rgb() pattern against an untrimmed string made it
  // silently return null for exactly the input this function exists to handle.
  const value = color.trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1]!;
    const full =
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h;
    const n = parseInt(full, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  const fn = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (fn) {
    // Clamp: the hex branch is bounded by its 0xff masks, but this one accepts any
    // digits the regex matches, so a malformed `rgb(300, 0, 0)` would escape as
    // r = 300 and skew every downstream luminance/contrast computation instead of
    // being rejected or corrected at the boundary.
    return { r: clampChannel(+fn[1]!), g: clampChannel(+fn[2]!), b: clampChannel(+fn[3]!) };
  }
  return null;
}
