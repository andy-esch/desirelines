/**
 * Shared styling for sport toggle chips (Charts/List filters and the map's sport filter).
 *
 * The rule: the sport colour is an ACCENT, never the text. Full-brightness neon as a
 * label fails 3:1 on the light ground for most of the palette, so an unselected chip
 * pairs a neutral label with a glowing colour dot and a hairline tinted toward the
 * colour; a selected chip turns the neon into the fill. That keeps the palette acid-bright
 * in both themes without dimming it to make it legible.
 *
 * Callers put the sport colour and its ink on the item with `sportChipStyle`, and render
 * `<SportChipDot />` as the first child.
 */
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { readableInk } from "@/utils/colorTokens";

/**
 * The item's inline style: the sport colour as `--chip`, and as `--chip-ink` the black or
 * white that reads on it, for a theme that inks a selected chip per sport.
 */
export function sportChipStyle(color: string): CSSProperties {
  const ink = readableInk(color);
  return { "--chip": color, ...(ink && { "--chip-ink": ink }) } as CSSProperties;
}

/**
 * Classes for the chip itself. Include `group` — the dot keys off the item's pressed
 * state.
 *
 * The theme sets how much of the sport colour fills a selected chip; what the fill leaves
 * goes to the border, so a filled chip keeps the mark outline and an outlined one (Arcade)
 * takes the sport colour there. Its label mixes the sport colour into the ink by its own
 * strength, and its glows are shadow utilities, so they compose with the focus ring.
 */
export const sportChipClass = cn(
  "group h-(--chip-height) rounded-(--chip-radius)",
  // The theme sets how much sport color tints the border and the hover fill.
  "border border-[color-mix(in_srgb,var(--chip)_var(--chip-border-strength),var(--color-chip-hairline))]",
  "bg-transparent text-foreground",
  "hover:bg-[color-mix(in_srgb,var(--chip)_var(--chip-hover-strength),transparent)] hover:text-foreground",
  "data-[pressed]:bg-[color-mix(in_srgb,var(--chip)_var(--chip-selected-fill-strength),transparent)]",
  // A filled chip's border is the mark outline, not transparent: a bright fill can sit at
  // ~1:1 against the light ground, so a transparent border let the whole chip melt into
  // the page.
  "data-[pressed]:border-[color-mix(in_srgb,var(--chip)_calc(100%_-_var(--chip-selected-fill-strength)),var(--color-chart-mark-outline))]",
  // The ink is the theme's, else the sport's black or white, else the accent ink. (Written
  // out in full here and on the dot: Tailwind only builds classes it finds whole.)
  "data-[pressed]:text-[color-mix(in_srgb,var(--chip)_var(--chip-selected-label-strength),var(--chip-selected-ink,var(--chip-ink,var(--color-on-accent))))]",
  // A chip is a toggle item, so it would also take the theme's pressed-toggle glows; its
  // own, in its sport colour, replace them.
  "data-[pressed]:shadow-[0_0_var(--chip-selected-glow-size)_color-mix(in_srgb,var(--chip)_var(--chip-selected-glow-strength),transparent)]",
  "data-[pressed]:inset-shadow-[0_0_var(--chip-selected-inset-glow-size)_color-mix(in_srgb,var(--chip)_var(--chip-selected-glow-strength),transparent)]",
  "data-[pressed]:[text-shadow:none]"
);

/**
 * The glowing sport-colour dot that carries identity while the label stays neutral.
 *
 * On a filled chip the glow has nothing to glow against, so the dot inverts to the label
 * ink instead of disappearing — which also keeps the chip's width stable on toggle. On an
 * outlined chip it keeps the sport colour.
 */
export function SportChipDot() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "sport-mark size-2 shrink-0 rounded-(--chip-dot-radius) bg-[var(--chip)]",
        "shadow-[0_0_7px_var(--chip),0_0_2px_var(--chip)]",
        "group-data-[pressed]:bg-[color-mix(in_srgb,var(--chip)_calc(100%_-_var(--chip-selected-fill-strength)),var(--chip-selected-ink,var(--chip-ink,var(--color-on-accent))))] group-data-[pressed]:shadow-none"
      )}
    />
  );
}
