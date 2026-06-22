import * as React from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cn } from "@/lib/utils";

/**
 * Tooltip — shadcn-style wrapper over Base UI's Tooltip, themed via the `@theme`
 * shim. Wrap the app (or a subtree) in `<TooltipProvider>` once; then:
 *   <Tooltip>
 *     <TooltipTrigger />
 *     <TooltipContent>…</TooltipContent>
 *   </Tooltip>
 */
const TooltipProvider = BaseTooltip.Provider;
const Tooltip = BaseTooltip.Root;
const TooltipTrigger = BaseTooltip.Trigger;

type StringClass<T> = Omit<T, "className"> & { className?: string };

function TooltipContent({
  className,
  children,
  sideOffset = 6,
  ...props
}: StringClass<React.ComponentProps<typeof BaseTooltip.Popup>> & { sideOffset?: number }) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={sideOffset} className="z-50 outline-none">
        <BaseTooltip.Popup
          className={cn(
            "rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md shadow-black/40",
            "transition-[transform,opacity] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            className
          )}
          {...props}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
