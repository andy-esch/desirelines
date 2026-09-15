import { useState, useRef, useEffect, useCallback, useId, type ReactNode } from "react";
import { ChevronDownIcon } from "../icons";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { Panel } from "../theme/Panel";

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
 * - Click the header to toggle
 * - Chevron rotates to indicate state
 * - Smooth height animation (respects prefers-reduced-motion)
 * - Keyboard accessible (Enter/Space to toggle)
 * - ARIA attributes for screen readers
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

  // Measure content height for animation
  useEffect(() => {
    if (!contentRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContentHeight(entry.contentRect.height);
      }
    });

    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const animationDuration = reducedMotion ? "0ms" : "200ms";

  return (
    <div className="mb-6" id={id}>
      <Panel bodyClassName="p-0">
        <div
          id={headerId}
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="flex cursor-pointer select-none items-start justify-between border-b border-divider p-(--panel-header-padding)"
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
        >
          <div className="flex-1">
            <h5 className="mb-0 text-body-text">{title}</h5>
            {description && <p className="text-muted-text text-sm mb-0 mt-1">{description}</p>}
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
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          style={{
            overflow: "hidden",
            transition: `height ${animationDuration} ease`,
            height: expanded
              ? contentHeight !== undefined
                ? `${contentHeight}px`
                : "auto"
              : "0px",
          }}
        >
          <div ref={contentRef} className="p-(--panel-body-padding)">
            {children}
          </div>
        </div>
      </Panel>
    </div>
  );
}
