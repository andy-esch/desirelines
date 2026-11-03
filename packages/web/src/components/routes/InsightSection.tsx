import type { ReactNode } from "react";
import { SectionLabel } from "../theme/SectionLabel";
import { useHeadingLevel } from "../theme/useHeadingLevel";

export interface InsightSectionProps {
  title: ReactNode;
  /** Accessible name for the section. */
  ariaLabel: string;
  /** `id` for the title, for a panel whose list is labelled by it. */
  labelId?: string;
  /** Right-aligned header control, such as a metric toggle. */
  action?: ReactNode;
  /** Space below a header that carries an `action`. */
  headerSpacing?: "mb-2" | "mb-3";
  /** Show the empty state instead of `children`. */
  isEmpty: boolean;
  emptyText?: string;
  children: ReactNode;
}

/**
 * One routes-map insight panel: the section, its title, an optional header
 * control, and the empty state. Each chart supplies its own body.
 *
 * The title is a heading at the surrounding level (the Charts drawer raises it
 * below its own heading), drawn by the theme's `SectionLabel` like every other
 * panel title.
 */
export function InsightSection({
  title,
  ariaLabel,
  labelId,
  action,
  headerSpacing = "mb-2",
  isEmpty,
  emptyText = "No activities to summarize.",
  children,
}: InsightSectionProps) {
  const heading = `h${useHeadingLevel()}` as const;
  return (
    <section className="px-4 py-3" aria-label={ariaLabel}>
      {action ? (
        <div className={`${headerSpacing} flex items-center justify-between gap-2`}>
          <SectionLabel as={heading} id={labelId}>
            {title}
          </SectionLabel>
          {action}
        </div>
      ) : (
        <SectionLabel as={heading} id={labelId} className="mb-2">
          {title}
        </SectionLabel>
      )}
      {isEmpty ? <p className="text-xs text-muted-text">{emptyText}</p> : children}
    </section>
  );
}
