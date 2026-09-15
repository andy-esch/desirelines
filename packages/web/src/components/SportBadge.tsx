import type { CSSProperties, ReactNode } from "react";

/**
 * A sport label with its color, drawn like the sport chips: a glowing dot and a tinted
 * hairline, while the label keeps the body text color. As the sport color, the label sat
 * under 3:1 on the light ground for most sports.
 */
export function SportBadge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-[0.45em] whitespace-nowrap rounded-sm border border-[color-mix(in_srgb,var(--sport-color)_55%,var(--color-chip-hairline))] bg-[color-mix(in_srgb,var(--sport-color)_15%,transparent)] px-[0.5em] py-[0.2em] text-[0.7rem] font-semibold leading-none text-body-text"
      style={{ "--sport-color": color } as CSSProperties}
    >
      {/* Ring first, then the glow: the neon fill needs a boundary on the light ground. */}
      <span
        aria-hidden="true"
        className="size-[0.5em] flex-none rounded-full bg-(--sport-color) [box-shadow:0_0_0_1px_var(--color-chart-mark-outline),0_0_7px_var(--sport-color),0_0_2px_var(--sport-color)]"
      />
      {children}
    </span>
  );
}
