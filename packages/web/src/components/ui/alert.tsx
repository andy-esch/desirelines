import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Alert — a bordered, tinted message box. `variant` sets the tone. Pass `role="alert"` (or
 * `role="status"`) where the message should be announced; the component doesn't assume it.
 */
const alertVariants = cva("rounded-md border px-4 py-3", {
  variants: {
    variant: {
      danger: "border-danger/25 bg-danger/10 text-danger",
      warning: "border-warning/25 bg-warning/10 text-warning",
      success: "border-success/25 bg-success/10 text-success",
      info: "border-surface-border bg-surface-hover text-body-text",
      // The demo-mode banner is decorative, so it takes the neon accent rather than the
      // interactive one.
      demo: "border-neon-accent/30 border-l-[3px] border-l-neon-accent bg-neon-accent/8 text-subtle-text",
    },
  },
  defaultVariants: { variant: "info" },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  ref?: React.Ref<HTMLDivElement>;
}

function Alert({ className, variant, ...props }: AlertProps) {
  return <div className={cn(alertVariants({ variant }), className)} {...props} />;
}

export { Alert, alertVariants };
