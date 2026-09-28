import { useState, useRef, useEffect, useCallback, useId, type ReactNode } from "react";
import { ChevronDownIcon } from "../icons";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { NextHeadingLevel } from "../theme/NextHeadingLevel";
import { Panel } from "../theme/Panel";
import { SectionLabel } from "../theme/SectionLabel";
import { useHeadingLevel } from "../theme/useHeadingLevel";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
  /** Optional id for anchor link support */
  id?: string;
  /** Whether the section starts expanded (default: true) */
  defaultExpanded?: boolean;
}

/**
 * Reusable collapsible section wrapper for the settings page.
 * Provides consistent styling for grouped settings with expand/collapse.
 *
 * - The title is a heading holding the collapse button (the disclosure pattern), so the
 *   sections show up in a screen reader's heading list; the description describes it
 * - Clicking anywhere on the header row toggles, and keyboard focus rings the whole row
 * - Chevron rotates to indicate state
 * - Smooth height animation (respects prefers-reduced-motion)
 */
export function SettingsSection({
  title,
  description,
  children,
  id,
  defaultExpanded = true,
}: SettingsSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);
  const reducedMotion = useReducedMotion();
  const generatedId = useId();
  const panelId = `${generatedId}-panel`;
  const headerId = `${generatedId}-header`;
  const descriptionId = `${generatedId}-description`;
  const Heading = `h${useHeadingLevel()}` as const;

  // Measure content height for animation
  useEffect(() => {
    if (!contentRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // The border box, not `contentRect`: the measured element carries the panel's own
        // padding, and a content-box height cut that much off the end of a long section
        // (the sport list lost its "N of 17 sports visible" footer).
        const borderBox = entry.borderBoxSize?.[0]?.blockSize;
        setContentHeight(borderBox ?? (entry.target as HTMLElement).offsetHeight);
      }
    });

    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const animationDuration = reducedMotion ? "0ms" : "200ms";

  // The button's ::after stretches over the whole row, so a click anywhere on it toggles;
  // the row draws the focus ring the button hides, as it did when the row was the control.
  const header = (
    <div className="relative flex cursor-pointer select-none items-start justify-between gap-4 has-[:focus-visible]:control-focus-ring">
      <div className="flex-1">
        <Heading className="m-0 [font-family:inherit] font-normal">
          <button
            type="button"
            id={headerId}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-describedby={description ? descriptionId : undefined}
            onClick={toggle}
            className="cursor-pointer text-left outline-none after:absolute after:inset-0"
          >
            <SectionLabel>{title}</SectionLabel>
          </button>
        </Heading>
        {description && (
          <p id={descriptionId} className="text-muted-text text-sm mb-0 mt-1.5">
            {description}
          </p>
        )}
      </div>
      <span
        className="inline-flex items-center mt-1 ms-3"
        aria-hidden="true"
        style={{
          transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
          transition: `transform ${animationDuration} ease`,
        }}
      >
        <ChevronDownIcon size={14} />
      </span>
    </div>
  );

  const body = (
    <div
      id={panelId}
      role="region"
      aria-labelledby={headerId}
      style={{
        overflow: "hidden",
        transition: `height ${animationDuration} ease`,
        height: expanded ? (contentHeight !== undefined ? `${contentHeight}px` : "auto") : "0px",
      }}
    >
      <div ref={contentRef} className="p-(--panel-body-padding)">
        <NextHeadingLevel>{children}</NextHeadingLevel>
      </div>
    </div>
  );

  // The title and description sit above the panel as its label, with the collapse control
  // beside them.
  return (
    <section className="mb-6 flex flex-col gap-3.5" id={id}>
      {header}
      <Panel bodyClassName="p-0">{body}</Panel>
    </section>
  );
}
