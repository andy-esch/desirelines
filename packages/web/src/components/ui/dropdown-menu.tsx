import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

/**
 * DropdownMenu — shadcn-style wrapper over Base UI's Menu, themed via the
 * `@theme` shim. Use `DropdownMenuLinkItem` (Base UI `Menu.LinkItem`) for
 * navigation links, e.g. `render={<Link to="…" />}`.
 */
const DropdownMenu = Menu.Root;
const DropdownMenuTrigger = Menu.Trigger;
const DropdownMenuGroup = Menu.Group;

type StringClass<T> = Omit<T, "className"> & { className?: string };
type PositionerProps = React.ComponentProps<typeof Menu.Positioner>;

function DropdownMenuContent({
  className,
  children,
  sideOffset = 4,
  align = "start",
  side,
  ...props
}: StringClass<React.ComponentProps<typeof Menu.Popup>> & {
  sideOffset?: number;
  align?: PositionerProps["align"];
  side?: PositionerProps["side"];
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        sideOffset={sideOffset}
        align={align}
        side={side}
        className="z-50 outline-none"
      >
        <Menu.Popup
          className={cn(
            "min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg shadow-black/40",
            "transition-[transform,opacity] data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            className
          )}
          {...props}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

const itemBase =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none " +
  "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

function DropdownMenuItem({
  className,
  ...props
}: StringClass<React.ComponentProps<typeof Menu.Item>>) {
  return <Menu.Item className={cn(itemBase, className)} {...props} />;
}

function DropdownMenuLinkItem({
  className,
  ...props
}: StringClass<React.ComponentProps<typeof Menu.LinkItem>>) {
  return <Menu.LinkItem className={cn(itemBase, "no-underline", className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuGroup,
};
