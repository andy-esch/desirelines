import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import type { HeadingLevel } from "./useHeadingLevel";
import { useThemeStructure } from "./useThemeStructure";

export interface SectionLabelProps extends HTMLAttributes<HTMLElement> {
  /**
   * The element: a heading where the label titles what follows (a panel's title), a span
   * otherwise (its meta). A heading drops the margin and the display face `h1` to `h3`
   * take, so it looks exactly like the span.
   */
  as?: "span" | `h${HeadingLevel}` | undefined;
}

/**
 * The theme's mark before a section title, where its `sectionLabelMark` draws one: a pill in
 * `--label-mark` with `--label-mark-glow`. Nothing otherwise.
 */
export function LabelMark() {
  const { sectionLabelMark } = useThemeStructure();
  if (sectionLabelMark !== "pill") return null;
  return (
    <span
      aria-hidden="true"
      className="h-[5px] w-5 shrink-0 rounded-[3px] [background:var(--label-mark)] [box-shadow:var(--label-mark-glow)]"
    />
  );
}

/**
 * A section or panel label. Size, tracking, color and case come from the theme's
 * `--label-*` slots, so a theme decides whether labels are tracked uppercase. A label that
 * titles what follows (a heading) takes the theme's mark before it; a panel's meta doesn't.
 */
export function SectionLabel({
  as: Element = "span",
  className,
  children,
  ...props
}: SectionLabelProps) {
  const { sectionLabelMark } = useThemeStructure();
  const marked = Element !== "span" && sectionLabelMark !== "none";
  return (
    <Element
      className={cn(
        "text-(length:--label-size) leading-tight font-(weight:--label-weight) tracking-(--label-tracking) text-(color:--label-color) [text-transform:var(--label-case)]",
        Element !== "span" && "m-0 [font-family:inherit]",
        marked && "flex items-center gap-2.5",
        className
      )}
      {...props}
    >
      {marked && <LabelMark />}
      {children}
    </Element>
  );
}
