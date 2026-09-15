import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionLabel } from "./SectionLabel";
import { useThemeStructure } from "./useThemeStructure";

export type PanelAccent = 1 | 2 | 3;

/** Complete class strings per accent, so Tailwind's scanner sees every one. */
export const PANEL_ACCENT_BORDER: Record<PanelAccent, string> = {
  1: "border-(color:--panel-accent-1)",
  2: "border-(color:--panel-accent-2)",
  3: "border-(color:--panel-accent-3)",
};
const ACCENT_INK: Record<PanelAccent, string> = {
  1: "text-(color:--panel-accent-1-ink)",
  2: "text-(color:--panel-accent-2-ink)",
  3: "text-(color:--panel-accent-3-ink)",
};

export interface PanelProps {
  /** Panel title. Where it renders depends on the theme's `sectionLabelPlacement`. */
  title?: ReactNode | undefined;
  /** Short context shown with the title, e.g. `PAGE 1/5`. */
  meta?: ReactNode | undefined;
  /** Controls that belong to the panel, e.g. a range toggle; they sit in the title row. */
  actions?: ReactNode | undefined;
  /** Which of the theme's three panel accents frames the panel. */
  accent?: PanelAccent | undefined;
  /** The one panel in a group that should stand out. */
  emphasis?: boolean | undefined;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  children: ReactNode;
}

/**
 * A framed content surface. The frame comes from the `--panel-*` slots; the title goes in
 * a card header, a label above the frame, or a header bar inside it, per the theme.
 */
export function Panel({
  title,
  meta,
  actions,
  accent = 1,
  emphasis = false,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const { sectionLabelPlacement } = useThemeStructure();
  const hasHeader = title != null || meta != null || actions != null;
  const actionsNode = actions != null && (
    <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
  );

  const frame = cn(
    "flex flex-col min-w-0 bg-(--panel-bg) border-solid border-(length:--panel-border-width) rounded-(--panel-radius)",
    PANEL_ACCENT_BORDER[accent],
    emphasis ? "[box-shadow:var(--panel-shadow-emphasis)]" : "[box-shadow:var(--panel-shadow)]",
    "transition-colors hover:border-(color:--color-panel-border-hover)"
  );
  const body = (
    <div className={cn("min-w-0 p-(--panel-body-padding)", bodyClassName)}>{children}</div>
  );
  const metaNode = meta != null && (
    <span className="shrink-0 text-(color:--color-muted-text)">{meta}</span>
  );

  if (hasHeader && sectionLabelPlacement === "above") {
    return (
      <section className={cn("flex flex-col gap-3.5 min-w-0", className)} data-placement="above">
        <div
          className={cn(
            "flex flex-wrap justify-between gap-x-4 gap-y-2",
            actions != null ? "items-center" : "items-baseline"
          )}
        >
          {/* With actions on the right, the meta joins the title on the left. */}
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 min-w-0">
            <SectionLabel>{title}</SectionLabel>
            {meta != null && actions != null && (
              <SectionLabel className="text-(color:--color-muted-text)">{meta}</SectionLabel>
            )}
          </div>
          {meta != null && actions == null && (
            <SectionLabel className="text-(color:--color-muted-text)">{meta}</SectionLabel>
          )}
          {actionsNode}
        </div>
        <div className={frame}>{body}</div>
      </section>
    );
  }

  if (hasHeader && sectionLabelPlacement === "header-bar") {
    return (
      <section className={cn(frame, className)} data-placement="header-bar">
        <div
          className={cn(
            "flex items-center justify-between gap-4 px-3.5 py-2.5 border-b border-solid border-(length:--panel-border-width)",
            PANEL_ACCENT_BORDER[accent]
          )}
        >
          <SectionLabel className={ACCENT_INK[accent]}>{title}</SectionLabel>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
            {meta != null && <SectionLabel className={ACCENT_INK[accent]}>{meta}</SectionLabel>}
            {actionsNode}
          </div>
        </div>
        {body}
      </section>
    );
  }

  return (
    <section className={cn(frame, className)} data-placement={hasHeader ? "card-header" : "none"}>
      {hasHeader && (
        <div
          className={cn(
            "flex justify-between gap-4 p-(--panel-header-padding) border-b border-divider",
            actions != null ? "items-center" : "items-baseline"
          )}
        >
          <h3 className="m-0 text-base font-normal [font-family:inherit] text-body-text">
            {title}
          </h3>
          {(meta != null || actions != null) && (
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              {metaNode}
              {actionsNode}
            </div>
          )}
        </div>
      )}
      {body}
    </section>
  );
}
