import * as React from "react";
import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { CheckIcon, CloseIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * Combobox — shadcn-style wrapper over Base UI's Combobox, themed via the
 * `@theme` shim. Single-select (search input) or **multi-select** (`multiple`,
 * with selected items shown as chips) — the sport/region pickers in the map
 * filters. Built-in client filtering is available via `BaseCombobox.useFilter`
 * (re-exported as `useComboboxFilter`); pass `items` to `<Combobox>`.
 *
 *   <Combobox multiple items value onValueChange>
 *     <ComboboxChips>
 *       …chips… <ComboboxInput placeholder="Sports" />
 *     </ComboboxChips>
 *     <ComboboxContent>
 *       <ComboboxEmpty>No matches</ComboboxEmpty>
 *       <ComboboxList>{(item) => <ComboboxItem value={item}>{item}</ComboboxItem>}</ComboboxList>
 *     </ComboboxContent>
 *   </Combobox>
 */
const Combobox = BaseCombobox.Root;
const ComboboxValue = BaseCombobox.Value;
const ComboboxGroup = BaseCombobox.Group;
const ComboboxClear = BaseCombobox.Clear;
const useComboboxFilter = BaseCombobox.useFilter;

type StringClass<T> = Omit<T, "className"> & { className?: string };

function ComboboxInput({
  className,
  ...props
}: StringClass<React.ComponentProps<typeof BaseCombobox.Input>>) {
  return (
    <BaseCombobox.Input
      className={cn(
        "min-w-24 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function ComboboxChips({
  className,
  ...props
}: StringClass<React.ComponentProps<typeof BaseCombobox.Chips>>) {
  return (
    <BaseCombobox.Chips
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5",
        "focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
        className
      )}
      {...props}
    />
  );
}

function ComboboxChip({
  className,
  children,
  ...props
}: StringClass<React.ComponentProps<typeof BaseCombobox.Chip>>) {
  return (
    <BaseCombobox.Chip
      className={cn(
        "flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground",
        className
      )}
      {...props}
    >
      {children}
      <BaseCombobox.ChipRemove
        className="rounded-sm opacity-60 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label="Remove"
      >
        <CloseIcon />
      </BaseCombobox.ChipRemove>
    </BaseCombobox.Chip>
  );
}

function ComboboxContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: StringClass<React.ComponentProps<typeof BaseCombobox.Popup>> & { sideOffset?: number }) {
  return (
    <BaseCombobox.Portal>
      <BaseCombobox.Positioner sideOffset={sideOffset} className="z-50 outline-none">
        <BaseCombobox.Popup
          className={cn(
            "max-h-[min(var(--available-height),20rem)] w-[var(--anchor-width)] min-w-[8rem] overflow-y-auto overscroll-contain",
            "rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg shadow-black/40",
            "transition-[transform,opacity] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            className
          )}
          {...props}
        >
          {children}
        </BaseCombobox.Popup>
      </BaseCombobox.Positioner>
    </BaseCombobox.Portal>
  );
}

function ComboboxList({
  className,
  ...props
}: StringClass<React.ComponentProps<typeof BaseCombobox.List>>) {
  return <BaseCombobox.List className={cn("outline-none", className)} {...props} />;
}

function ComboboxItem({
  className,
  children,
  ...props
}: StringClass<React.ComponentProps<typeof BaseCombobox.Item>>) {
  return (
    <BaseCombobox.Item
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground outline-none",
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[selected]:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        <BaseCombobox.ItemIndicator>
          <CheckIcon />
        </BaseCombobox.ItemIndicator>
      </span>
      <span className="truncate">{children}</span>
    </BaseCombobox.Item>
  );
}

function ComboboxEmpty({
  className,
  ...props
}: StringClass<React.ComponentProps<typeof BaseCombobox.Empty>>) {
  return (
    <BaseCombobox.Empty
      className={cn("px-2 py-1.5 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function ComboboxGroupLabel({
  className,
  ...props
}: StringClass<React.ComponentProps<typeof BaseCombobox.GroupLabel>>) {
  return (
    <BaseCombobox.GroupLabel
      className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxValue,
  ComboboxInput,
  ComboboxChips,
  ComboboxChip,
  ComboboxClear,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  useComboboxFilter,
};
