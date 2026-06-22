import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Select — shadcn-style wrapper over Base UI's Select, themed via the `@theme`
 * alias shim (bg-popover / border-border / ring-ring / …). Anatomy:
 *   <Select value onValueChange>
 *     <SelectTrigger><SelectValue/></SelectTrigger>
 *     <SelectContent><SelectItem value>…</SelectItem></SelectContent>
 *   </Select>
 */
const Select = BaseSelect.Root;
const SelectValue = BaseSelect.Value;
const SelectGroup = BaseSelect.Group;

type StringClass<T> = Omit<T, "className"> & { className?: string };

function SelectTrigger({
  className,
  children,
  ...props
}: StringClass<React.ComponentProps<typeof BaseSelect.Trigger>>) {
  return (
    <BaseSelect.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground",
        "transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="truncate text-left">{children}</span>
      <BaseSelect.Icon className="shrink-0 opacity-50">
        <ChevronDownIcon />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

function SelectContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: StringClass<React.ComponentProps<typeof BaseSelect.Popup>> & { sideOffset?: number }) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={sideOffset} className="z-50 outline-none">
        <BaseSelect.Popup
          className={cn(
            "max-h-[var(--available-height)] min-w-[var(--anchor-width)] overflow-y-auto overscroll-contain",
            "rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg shadow-black/40",
            "transition-[transform,opacity] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            className
          )}
          {...props}
        >
          {children}
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: StringClass<React.ComponentProps<typeof BaseSelect.Item>>) {
  return (
    <BaseSelect.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[selected]:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        <BaseSelect.ItemIndicator>
          <CheckIcon />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText className="truncate">{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectGroup };
