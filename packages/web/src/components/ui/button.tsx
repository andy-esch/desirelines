import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button — shadcn-style button with `cva` variants, themed via the `@theme`
 * shim (bg-primary / bg-secondary / bg-destructive / border-input / …). A plain
 * native `<button>` (no Base UI primitive needed); pass `ref` directly (React 19).
 */
const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-(--button-radius) text-(length:--control-font-size) leading-[calc(1.25/0.875)] font-medium tracking-(--button-tracking) [text-transform:var(--button-case)]",
    "transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
    "disabled:pointer-events-none disabled:opacity-50"
  ),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline:
          "border border-input bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // Outlined status buttons: a retry inside an error, a show-sport action, a reset.
        "outline-danger":
          "border border-danger bg-transparent text-danger hover:bg-danger hover:text-destructive-foreground",
        "outline-success":
          "border border-success bg-transparent text-success hover:bg-success hover:text-bg-body",
        "outline-warning":
          "border border-warning bg-transparent text-warning hover:bg-warning hover:text-on-accent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-(--control-height) px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-6",
        icon: "h-(--control-height) w-(--control-height)",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  ref?: React.Ref<HTMLButtonElement>;
}

function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
