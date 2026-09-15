import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge — small status/label pill with `cva` variants, themed via the `@theme`
 * shim. Used for active-filter summaries, counts, sport tags in the map UI.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        // A fill set by the caller (a goal color, a status color) with dark ink.
        solid: "border-transparent text-on-accent",
      },
      size: {
        default: "",
        // Small status and count pills in tables and section headings.
        compact: "rounded-sm px-[0.5em] py-[0.2em] text-[0.7rem] font-semibold leading-none",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}

export { Badge, badgeVariants };
