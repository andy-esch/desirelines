import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { NextHeadingLevel } from "./NextHeadingLevel";
import { useHeadingLevel } from "./useHeadingLevel";

export interface SectionProps {
  /** The section heading, e.g. `Recent activity`. */
  title: ReactNode;
  /** Short context shown with the title. */
  meta?: ReactNode | undefined;
  /** Controls for everything in the section, e.g. a time range toggle. */
  actions?: ReactNode | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * A heading row over content that spans more than one panel, titled in the `--label-*`
 * slots. A single panel takes its title through `Panel` instead, so the theme can place it
 * inside the frame. The heading is at the level `useHeadingLevel` gives, and the panels
 * under it sit one level below.
 */
export function Section({ title, meta, actions, className, children }: SectionProps) {
  const Heading = `h${useHeadingLevel()}` as const;
  return (
    <section className={cn("flex flex-col gap-3.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Heading className="m-0 flex flex-wrap items-baseline gap-x-3.5 gap-y-1 [font-family:inherit] font-normal text-(length:--label-size) leading-tight tracking-(--label-tracking) text-(color:--label-color) [text-transform:var(--label-case)]">
          {title}
          {meta != null && <span className="text-(color:--color-muted-text)">{meta}</span>}
        </Heading>
        {actions}
      </div>
      <NextHeadingLevel>{children}</NextHeadingLevel>
    </section>
  );
}
