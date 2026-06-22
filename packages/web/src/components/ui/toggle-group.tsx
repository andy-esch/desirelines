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
        "inline-flex items-center gap-1 rounded-md border border-border bg-card p-1",
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
        "inline-flex items-center justify-center gap-1.5 rounded-sm px-2.5 py-1 text-sm font-medium text-foreground outline-none transition-colors",
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
