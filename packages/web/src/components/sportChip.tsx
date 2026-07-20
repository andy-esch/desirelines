/**
 * Shared styling for sport toggle chips (Charts/List filters and the map's sport filter).
 *
 * The rule: the sport colour is an ACCENT, never the text. Full-brightness neon as a
 * label fails 3:1 on the light ground for most of the palette, so an unselected chip
 * pairs a neutral label with a glowing colour dot and a hairline tinted toward the
 * colour; a selected chip turns the neon into the fill. That keeps the palette acid-bright
 * in both themes without dimming it to make it legible.
 *
 * Callers set the sport colour as a `--chip` custom property on the item, and render
 * `<SportChipDot />` as the first child.
 */
import { cn } from "@/lib/utils";

/**
 * Classes for the chip itself. Include `group` — the dot keys off the item's pressed
 * state.
 *
 * Note `data-[pressed]:text-sport-on` rather than `text-bg-body`: the pressed fill is
 * bright in BOTH themes, and `bg-body` is *light* in light mode, which would put light
 * text on a bright fill.
 */
export const sportChipClass = cn(
  "group",
  "border border-[color-mix(in_srgb,var(--chip)_55%,var(--color-chip-hairline))]",
  "bg-transparent text-foreground",
  "hover:bg-[color-mix(in_srgb,var(--chip)_10%,transparent)] hover:text-foreground",
  // The pressed border is the mark outline, not transparent: a bright fill can sit at
  // ~1:1 against the light ground, so a transparent border let the whole chip melt into
  // the page.
  "data-[pressed]:border-chart-mark-outline data-[pressed]:bg-[var(--chip)] data-[pressed]:text-sport-on"
);

/**
 * The glowing sport-colour dot that carries identity while the label stays neutral.
 *
 * On the pressed fill the glow has nothing to glow against, so the dot inverts to the
 * label ink instead of disappearing — which also keeps the chip's width stable on toggle.
 */
export function SportChipDot() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "sport-mark size-2 shrink-0 rounded-full bg-[var(--chip)]",
        "shadow-[0_0_7px_var(--chip),0_0_2px_var(--chip)]",
        "group-data-[pressed]:bg-sport-on group-data-[pressed]:shadow-none"
      )}
    />
  );
}
