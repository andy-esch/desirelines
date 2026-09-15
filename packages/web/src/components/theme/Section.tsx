import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "./useThemeStructure";

export interface SectionProps {
  /** The section heading, e.g. `Recent activity`. */
  title: ReactNode;
  /** Short context shown with the title. */
  meta?: ReactNode | undefined;
  /** Controls for everything in the section, e.g. a time range toggle. */
  actions?: ReactNode | undefined;
  /**
   * Classes for the heading where the theme titles sections with headings (the
   * `card-header` placement). Themes that use section labels style the heading from the
   * `--label-*` slots instead.
   */
  headingClassName?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * A heading row over content that spans more than one panel. A single panel takes its
 * title through `Panel` instead, so the theme can place it inside the frame.
 */
export function Section({
  title,
  meta,
  actions,
  headingClassName,
  className,
  children,
}: SectionProps) {
  const { sectionLabelPlacement } = useThemeStructure();

  if (sectionLabelPlacement === "card-header") {
    return (
      <section className={className}>
        <div className="flex justify-between items-center gap-4 mb-3">
          <h2 className={cn("m-0", headingClassName)}>
            {title}
            {meta != null && <span className="ms-2 text-sm font-normal">{meta}</span>}
          </h2>
          {actions}
        </div>
        {children}
      </section>
    );
  }

  return (
    <section className={cn("flex flex-col gap-3.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="m-0 flex flex-wrap items-baseline gap-x-3.5 gap-y-1 [font-family:inherit] font-normal text-(length:--label-size) leading-tight tracking-(--label-tracking) text-(color:--label-color) [text-transform:var(--label-case)]">
          {title}
          {meta != null && <span className="text-(color:--color-muted-text)">{meta}</span>}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
