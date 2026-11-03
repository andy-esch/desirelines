import type { ReactNode } from "react";

/**
 * The label treatment the insight panels share. Kept inline rather than using
 * `SectionLabel`, which adds `leading-tight` and renders a span or a heading:
 * switching would change these panels' line height and markup.
 */
const LABEL_CLASS =
  "text-(length:--label-size) font-(weight:--label-weight) tracking-(--label-tracking) [text-transform:var(--label-case)] text-(color:--label-color)";

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
  /** Show the shared empty state instead of `children`. */
  isEmpty: boolean;
  children: ReactNode;
}

/**
 * One routes-map insight panel: the section, its title, an optional header
 * control, and the shared empty state. Each chart supplies its own body.
 */
export function InsightSection({
  title,
  ariaLabel,
  labelId,
  action,
  headerSpacing = "mb-2",
  isEmpty,
  children,
}: InsightSectionProps) {
  return (
    <section className="px-4 py-3" aria-label={ariaLabel}>
      {action ? (
        <div className={`${headerSpacing} flex items-center justify-between gap-2`}>
          <p id={labelId} className={LABEL_CLASS}>
            {title}
          </p>
          {action}
        </div>
      ) : (
        <p id={labelId} className={`mb-2 ${LABEL_CLASS}`}>
          {title}
        </p>
      )}
      {isEmpty ? <p className="text-xs text-muted-text">No activities to summarize.</p> : children}
    </section>
  );
}
