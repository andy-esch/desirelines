import type { ThemeDefinition } from "../../themes/registry";
import { HeroDecorationPreview } from "./HeroDecoration";

/**
 * A theme drawn small, for picking it: its ground, two bars in its accent where text would
 * be, and its hero decoration in miniature (see the Settings design, decision 1).
 *
 * It renders inside the theme's own `data-theme`, so every slot it reads is that theme's
 * whichever theme the page is in. The frame around it (border, selection) belongs to the
 * page's theme and is the caller's.
 */
export function ThemePreview({ theme }: { theme: ThemeDefinition }) {
  // The list's swatches lead with the ground, then the theme's accents.
  const accent = theme.swatches[1] ?? "currentColor";
  return (
    <div
      data-theme={theme.id}
      aria-hidden="true"
      className="absolute inset-0 overflow-hidden"
      style={{ background: "var(--color-bg-body)" }}
    >
      <HeroDecorationPreview kind={theme.structure.heroDecoration} />
      <span className="absolute left-2 top-[7px] h-1 w-[34px]" style={{ background: accent }} />
      <span
        className="absolute left-2 top-[15px] h-[3px] w-[22px] opacity-50"
        style={{ background: accent }}
      />
    </div>
  );
}
