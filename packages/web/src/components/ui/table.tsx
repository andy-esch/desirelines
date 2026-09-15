import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Table — a data table whose cells take padding from the theme's `--row-padding` slot and,
 * with `hover`, row highlight from `--row-hover-bg`. The cell rules live in the components
 * layer (`.data-table` in tailwind.css), so utilities on a `th` or `td` (a column's own
 * padding or alignment) still win.
 */
export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** Highlight the row under the pointer. */
  hover?: boolean | undefined;
  ref?: React.Ref<HTMLTableElement>;
}

function Table({ className, hover = false, ...props }: TableProps) {
  return (
    <table data-hover={hover ? "" : undefined} className={cn("data-table", className)} {...props} />
  );
}

export { Table };
