import * as React from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";

/**
 * Popover — shadcn-style wrapper over Base UI's Popover, themed via the `@theme`
 * shim. **Non-modal by default** (the map canvas must stay interactive behind
 * map-overlay popovers — see the UI-foundation research). Anatomy:
 *   <Popover>
 *     <PopoverTrigger />
 *     <PopoverContent>…</PopoverContent>
 *   </Popover>
 */
const Popover = BasePopover.Root;
const PopoverTrigger = BasePopover.Trigger;
const PopoverClose = BasePopover.Close;
const PopoverTitle = BasePopover.Title;
const PopoverDescription = BasePopover.Description;

type StringClass<T> = Omit<T, "className"> & { className?: string };
type PositionerProps = React.ComponentProps<typeof BasePopover.Positioner>;

function PopoverContent({
  className,
  children,
  sideOffset = 4,
  align = "center",
  side,
  ...props
}: StringClass<React.ComponentProps<typeof BasePopover.Popup>> & {
  sideOffset?: number;
  align?: PositionerProps["align"];
  side?: PositionerProps["side"];
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        sideOffset={sideOffset}
        align={align}
        side={side}
        className="z-50 outline-none"
      >
        <BasePopover.Popup
          className={cn(
            "min-w-[8rem] rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg shadow-black/40 outline-none",
            "transition-[transform,opacity] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            className
          )}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverClose, PopoverTitle, PopoverDescription };
