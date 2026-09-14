import * as React from "react";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { cn } from "@/lib/utils";

/**
 * ToggleGroup — shadcn-style wrapper over Base UI's ToggleGroup + Toggle, themed
 * via the `@theme` shim. Single- or multi-select (pass an array `value`); used
 * for the year quick-select and sport toggles in the map filters.
 *   <ToggleGroup value onValueChange>
 *     <ToggleGroupItem value="2026">2026</ToggleGroupItem>
 *   </ToggleGroup>
 */
type StringClass<T> = Omit<T, "className"> & { className?: string };

function ToggleGroup({
  className,
  ...props
}: StringClass<React.ComponentProps<typeof BaseToggleGroup>>) {
  return (
    <BaseToggleGroup
      className={cn(
        "inline-flex items-center gap-(--toggle-gap) rounded-(--toggle-frame-radius) border-(length:--toggle-frame-border-width) border-border bg-card p-(--toggle-frame-padding)",
        className
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: StringClass<React.ComponentProps<typeof BaseToggle>>) {
  return (
    <BaseToggle
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-(--toggle-item-radius) border-(length:--toggle-item-border-width) px-2.5 py-1 text-(length:--toggle-font-size) leading-[calc(1.25/0.875)] font-medium tracking-(--toggle-tracking) text-foreground [text-transform:var(--toggle-case)] outline-none transition-colors",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring/40",
        "data-[pressed]:bg-primary data-[pressed]:text-primary-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
