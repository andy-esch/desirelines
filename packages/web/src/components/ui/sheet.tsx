import * as React from "react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";

/**
 * Sheet — a side slide-over panel built on Base UI's Dialog (the shadcn "Sheet"
 * pattern). Controlled via `open` / `onOpenChange` on `<Sheet>`. Non-`<Popup>`
 * dismissal (backdrop / Esc) fires `onOpenChange(false)`.
 */
const Sheet = Dialog.Root;
const SheetTrigger = Dialog.Trigger;
const SheetClose = Dialog.Close;
const SheetTitle = Dialog.Title;

type StringClass<T> = Omit<T, "className"> & { className?: string };

function SheetContent({
  className,
  children,
  side = "left",
  ...props
}: StringClass<React.ComponentProps<typeof Dialog.Popup>> & { side?: "left" | "right" }) {
  const sideClasses =
    side === "left"
      ? "inset-y-0 left-0 data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full"
      : "inset-y-0 right-0 data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full";

  return (
    <Dialog.Portal>
      <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
      <Dialog.Popup
        className={cn(
          "fixed z-50 flex flex-col overflow-y-auto bg-background shadow-xl outline-none transition-transform duration-200",
          sideClasses,
          className
        )}
        {...props}
      >
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetTitle, SheetContent };
