import * as React from "react";
import { cn } from "@/lib/utils";
import { useThemeStructure } from "../theme/useThemeStructure";

/**
 * Table — a data table whose cells take padding from the theme's `--row-padding` slot and,
 * with `hover`, row highlight from `--row-hover-bg` plus, in themes whose structure asks for
 * it, a caret at the hovered row's left edge. The cell rules live in the components
 * layer (`.data-table` in tailwind.css), so utilities on a `th` or `td` (a column's own
 * padding or alignment) still win.
 */
export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Highlight the row under the pointer. */
  hover?: boolean | undefined;
  ref?: React.Ref<HTMLTableElement>;
}

function Table({ className, hover = false, ...props }: TableProps) {
  const { rowHoverCursor } = useThemeStructure();
  return (
    <table
      data-hover={hover ? "" : undefined}
      // Only meaningful alongside the hover highlight: a caret marking a row that is not
      // highlighted would point at nothing.
      data-row-cursor={hover && rowHoverCursor ? "" : undefined}
      className={cn("data-table", className)}
      {...props}
    />
  );
}

export { Table };
