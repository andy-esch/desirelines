import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A section or panel label. Size, tracking, color and case come from the theme's
 * `--label-*` slots, so a theme decides whether labels are tracked uppercase.
 */
export function SectionLabel({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "text-(length:--label-size) leading-tight tracking-(--label-tracking) text-(color:--label-color) [text-transform:var(--label-case)]",
        className
      )}
      {...props}
    />
  );
}
