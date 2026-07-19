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
 * Reference a color token at partial opacity.
 *
 * `tint("--color-neon-cyan", 12)` is equivalent to `rgba(0, 255, 255, 0.12)` when
 * that token holds `rgb(0, 255, 255)` — mixing N% of the color into transparent
 * yields exactly alpha = N/100.
 *
 * @param token - CSS custom property name, including the leading `--`
 * @param pct - opacity as a percentage (0-100)
 */
export function tint(token: string, pct: number): string {
  return `color-mix(in srgb, var(${token}) ${pct}%, transparent)`;
}
